import { Construct } from "constructs";
import { Duration, SecretValue, RemovalPolicy, CfnOutput, DockerImage } from "aws-cdk-lib";
import { Pipeline, Artifact, PipelineType } from "aws-cdk-lib/aws-codepipeline";
import { GitHubSourceAction, GitHubTrigger, CodeBuildAction, LambdaInvokeAction } from "aws-cdk-lib/aws-codepipeline-actions";
import { PipelineProject, LinuxArmBuildImage, LinuxBuildImage, ComputeType, BuildSpec, BuildEnvironmentVariable, BuildEnvironmentVariableType } from "aws-cdk-lib/aws-codebuild";
import { Bucket, type IBucket, BlockPublicAccess, ObjectOwnership, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { PolicyStatement, Effect, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import { Repository } from "aws-cdk-lib/aws-ecr";
import type { FunctionProps } from "../stack/FunctionProps";

export interface LambdaPipelineProps extends FunctionProps {
  lambdaFunction: LambdaFunction;
}

export class PipelineConstruct extends Construct {
  private resourceIdPrefix: string;
  private codeBuildProject: PipelineProject;
  public codePipeline: Pipeline;

  constructor(scope: Construct, id: string, props: LambdaPipelineProps) {
    super(scope, id);

    this.resourceIdPrefix = `${props.application}-${props.service}-${props.environment}`.substring(0, 42);
    
    if (props.functionProps?.dockerFile) {
      // create container pipeline
      this.codePipeline = this.createContainerPipeline(props);
    } else {
      // create build project
      this.codeBuildProject = this.createCodeBuild(props);
      // create pipeline
      this.codePipeline = this.createPipeline(props);
    }
  

    // Output pipeline name
    new CfnOutput(this, "CodePipelineName", {
      value: this.codePipeline.pipelineName,
      description: "The name of the Lambda deployment pipeline",
      exportName: `${this.resourceIdPrefix}-CodePipelineName`,
    });
  }

  /**
   * Create a CodePipeline for Docker-based Lambda deployment.
   * @param props
   * @returns pipeline
   */
  private createContainerPipeline(props: LambdaPipelineProps): Pipeline {
    // Artifact Buckets
    const artifactBucket = new Bucket(this, "PipelineArtifactsBucket", {
      bucketName: `${this.resourceIdPrefix}-pipeline-artifacts`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Artifacts
    const sourceOutput = new Artifact("SourceOutput");
    const dockerBuildOutput = new Artifact("DockerBuildOutput");

    // Source Action (GitHub)
    const sourceAction = new GitHubSourceAction({
      actionName: "GithubSourceAction",
      owner: props.sourceProps?.owner!,
      repo: props.sourceProps?.repo!,
      branch: props.sourceProps?.branchOrRef!,
      oauthToken: SecretValue.secretsManager(props.accessTokenSecretArn!),
      output: sourceOutput,
      trigger: GitHubTrigger.WEBHOOK,
    });

    // ECR repository for Lambda image (must exist and Lambda must use it)
    const ecr = new Repository(this, "LambdaRepo", {
      repositoryName: `${this.resourceIdPrefix}-repo`,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // Add this policy to the ECR repository
    ecr.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal("lambda.amazonaws.com")],
        actions: [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ],
      })
    );

    // Grant the Lambda function the right to pull images from ECR (all necessary permissions)
    ecr.grantPull(props.lambdaFunction);

    // Build & Push Docker image to ECR
    const dockerBuildProject = new PipelineProject(this, "DockerBuildProject", {
      projectName: `${this.resourceIdPrefix}-lambda-docker-build`,
      buildSpec: BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              "aws --version",
              "export IMAGE_TAG=$CODEBUILD_RESOLVED_SOURCE_VERSION",
              "aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ECR_REPO",
            ],
          },
          build: {
            commands: [
              "docker build -t $ECR_REPO:$IMAGE_TAG -f " +
                props.functionProps!.dockerFile +
                " .",
              "docker push $ECR_REPO:$IMAGE_TAG",
            ],
          },
          post_build: {
            commands: [
              "export IMAGE_URI=$ECR_REPO:$IMAGE_TAG",
              "echo $IMAGE_URI > imageUri.txt",
            ],
          },
        },
        artifacts: {
          files: ["imageUri.txt"],
        },
      }),
      environment: {
        buildImage: LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: ComputeType.SMALL,
        privileged: true,
      },
      environmentVariables: {
        ECR_REPO: { value: ecr.repositoryUri },
        ...(props.buildProps?.environment
          ? Object.entries(Object.assign({}, ...(props.buildProps.environment))).reduce(
              (acc, [key, value]) => ({ ...acc, [key]: { value, type: BuildEnvironmentVariableType.PLAINTEXT } }),
              {}
            )
          : {}),
        ...(props.buildProps?.secrets
          ? Object.fromEntries(
              props.buildProps.secrets.map(({ key, resource }) => [
                key,
                { value: resource, type: BuildEnvironmentVariableType.PARAMETER_STORE },
              ])
            )
          : {}),
      },
      timeout: Duration.minutes(20),
    });

    // Permissions for CodeBuild to push to ECR
    ecr.grantPullPush(dockerBuildProject);

    // Deploy Action: Update Lambda function with new image
    const deployProject = new PipelineProject(this, "DockerDeployProject", {
      projectName: `${this.resourceIdPrefix}-lambda-docker-deploy`,
      buildSpec: BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              "echo 'Starting Lambda deployment...'",
              "IMAGE_URI=$(cat imageUri.txt)",
              "echo 'Deploying image:' $IMAGE_URI",
            ],
          },
          build: {
            commands: [
              // Wait for Lambda to be ready and then update
              "aws lambda wait function-updated --function-name $LAMBDA_FUNCTION_NAME || echo 'Function already ready'",
              "aws lambda update-function-code --function-name $LAMBDA_FUNCTION_NAME --image-uri $IMAGE_URI",
              // Wait for the update to complete
              "aws lambda wait function-updated --function-name $LAMBDA_FUNCTION_NAME",
              "echo 'Lambda function updated successfully'",
            ],
          },
        },
      }),
      environment: {
        buildImage: LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: ComputeType.SMALL,
      },
      environmentVariables: {
        LAMBDA_FUNCTION_NAME: { value: props.lambdaFunction.functionName },
      },
      timeout: Duration.minutes(10),
    });

    // Permissions for CodeBuild to update Lambda
    deployProject.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["lambda:UpdateFunctionCode"],
        resources: [props.lambdaFunction.functionArn],
      })
    );

    // Enhanced permissions for deploy project
    deployProject.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "lambda:UpdateFunctionCode",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
        ],
        resources: [props.lambdaFunction.functionArn],
      })
    );

    // Grant ECR describe permissions
    deployProject.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "ecr:DescribeImages",
          "ecr:DescribeRepositories",
        ],
        resources: [ecr.repositoryArn],
      })
    );

    // Build Action
    const dockerBuildAction = new CodeBuildAction({
      actionName: "BuildAction",
      project: dockerBuildProject,
      input: sourceOutput,
      outputs: [dockerBuildOutput],
    });

    // Deploy Action
    const deployAction = new CodeBuildAction({
      actionName: "DeployAction",
      project: deployProject,
      input: dockerBuildOutput,
      runOrder: 2,
    });

    // Pipeline
    return new Pipeline(this, "DockerPipeline", {
      pipelineName: `${this.resourceIdPrefix}-docker-pipeline`,
      pipelineType: PipelineType.V2,
      artifactBucket,
      stages: [
        {
          stageName: "Source",
          actions: [sourceAction],
        },
        {
          stageName: "Build",
          actions: [dockerBuildAction],
        },
        {
          stageName: "Deploy",
          actions: [deployAction],
        },
      ],
    });
  }

  /**
   * Create CodeBuild Project
   * @param props 
   * @returns project
   */
  private createCodeBuild(props: LambdaPipelineProps): PipelineProject {
    // BuildSpec for Lambda (install, build, zip)
    const buildSpec = BuildSpec.fromObject({
      version: "0.2",
      phases: {
        install: {
          "runtime-versions": {
            [props.buildProps?.runtime || "nodejs"]: props.buildProps?.runtime_version || "20",
          },
          commands: [props.buildProps?.installcmd || "npm install"],
        },
        build: {
          commands: [props.buildProps?.buildcmd || "npm run build"],
        },
        post_build: {
          commands: [
            // Zip the Lambda code for deployment
            'zip -r function.zip .',
          ],
        },
      },
      artifacts: {
        files: ["function.zip"],
      },
    });

    // Build Environment Variables
    const buildEnvironmentVariables: Record<string, BuildEnvironmentVariable> = {
      ...(props.buildProps?.environment
        ? Object.fromEntries(
            Object.entries(Object.assign({}, ...(props.buildProps.environment))).map(([key, value]) => [
              key,
              { value, type: BuildEnvironmentVariableType.PLAINTEXT },
            ])
          )
        : {}),
      ...(props.buildProps?.secrets
        ? Object.fromEntries(
            props.buildProps.secrets.map(({ key, resource }) => [
              key,
              { value: resource, type: BuildEnvironmentVariableType.PARAMETER_STORE },
            ])
          )
        : {}),
    };

    // Build Action (CodeBuild)
    const buildProject = new PipelineProject(this, "LambdaBuildProject", {
      projectName: `${this.resourceIdPrefix}-lambda-build`,
      buildSpec,
      environment: {
        buildImage: LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: ComputeType.SMALL,
        privileged: false,
      },
      environmentVariables: buildEnvironmentVariables,
      timeout: Duration.minutes(10),
    });

    // Allow CodeBuild to update Lambda code
    buildProject.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["lambda:UpdateFunctionCode"],
        resources: [props.lambdaFunction.functionArn],
      })
    );

    // Allow CodeBuild to get secrets if needed
    buildProject.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [props.accessTokenSecretArn!],
      })
    );

    return buildProject;
  }

  /**
   * Create the CodePipeline
   * @param props 
   * @returns pipeline
   */
  private createPipeline(props: LambdaPipelineProps): Pipeline {
    // Artifact Buckets
    const artifactBucket = new Bucket(this, "PipelineArtifactsBucket", {
      bucketName: `${this.resourceIdPrefix}-pipeline-artifacts`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Artifacts
    const sourceOutput = new Artifact("SourceOutput");
    const buildOutput = new Artifact("BuildOutput");

    // Source Action (GitHub)
    const sourceAction = new GitHubSourceAction({
      actionName: "GithubSourceAction",
      owner: props.sourceProps?.owner!,
      repo: props.sourceProps?.repo!,
      branch: props.sourceProps?.branchOrRef!,
      oauthToken: SecretValue.secretsManager(props.accessTokenSecretArn!),
      output: sourceOutput,
      trigger: GitHubTrigger.WEBHOOK,
    });

    // Build Action
    const buildAction = new CodeBuildAction({
      actionName: "BuildAction",
      project: this.codeBuildProject,
      input: sourceOutput,
      outputs: [buildOutput],
    });

    // Deploy Action: Update Lambda code using CodeBuild (invoke AWS CLI)
    const deployProject = new PipelineProject(this, "LambdaDeployProject", {
      projectName: `${this.resourceIdPrefix}-lambda-deploy`,
      buildSpec: BuildSpec.fromObject({
        version: "0.2",
        phases: {
          build: {
            commands: [
              'aws lambda update-function-code --function-name $LAMBDA_FUNCTION_NAME --zip-file fileb://function.zip',
            ],
          },
        },
      }),
      environment: {
        buildImage: LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: ComputeType.SMALL,
      },
      environmentVariables: {
        LAMBDA_FUNCTION_NAME: { value: props.lambdaFunction.functionName },
      },
      timeout: Duration.minutes(5),
    });

    // Allow deploy project to update Lambda
    deployProject.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["lambda:UpdateFunctionCode"],
        resources: [props.lambdaFunction.functionArn],
      })
    );

    // Deploy Action
    const deployAction = new CodeBuildAction({
      actionName: "DeployAction",
      project: deployProject,
      input: buildOutput,
      runOrder: 2,
    });

    // Pipeline
    return new Pipeline(this, "LambdaPipeline", {
      pipelineName: `${this.resourceIdPrefix}-lambda-pipeline`,
      pipelineType: PipelineType.V2,
      artifactBucket,
      stages: [
        {
          stageName: "Source",
          actions: [sourceAction],
        },
        {
          stageName: "Build",
          actions: [buildAction],
        },
        {
          stageName: "Deploy",
          actions: [deployAction],
        },
      ],
    });
  }
}