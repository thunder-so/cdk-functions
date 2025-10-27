import fs from 'fs';
// @ts-expect-error library not fully ESM compatible
import fse from 'fs-extra/esm';
import path from 'path';
import { Aws, Duration, CfnOutput } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Function, FunctionUrl, Runtime, Code, Alias, Architecture, Tracing, FunctionUrlAuthType, DockerImageCode, DockerImageFunction, LayerVersion, InlineCode } from 'aws-cdk-lib/aws-lambda';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { ARecord, AaaaRecord, RecordTarget, HostedZone } from 'aws-cdk-lib/aws-route53';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { HttpApi, DomainName, EndpointType, SecurityPolicy, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Rule, Schedule, RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { FunctionProps as FnProps } from '../stack/FunctionProps';

export interface FunctionProps extends FnProps {
  repository: Repository;
}

export class FunctionsConstruct extends Construct {
  private readonly resourceIdPrefix: string;
  public lambdaFunction: Function;
  public lambdaFunctionUrl: FunctionUrl;
  private apiGateway: HttpApi;
  private rootDir: string;
  private codeDir: string;
  private domainName: DomainName;

  constructor(scope: Construct, id: string, props: FunctionProps) {
    super(scope, id);

    // Set the resource prefix
    this.resourceIdPrefix = `${props.application.substring(0, 7)}-${props.service.substring(0, 7)}-${props.environment.substring(0, 7)}`.substring(0, 23).toLowerCase();

    // Sanitize paths to ensure valid unix directory paths
    const sanitizePath = (path: string | undefined): string => {
      if (!path) return '';
      return path.replace(/[^a-zA-Z0-9._\-@#$%^&*+=~ /]|\/+/g, m => m.includes('/') ? '/' : '').replace(/^\/+|\/+$/g, '')
    };

    this.rootDir = path.join(props.contextDirectory || '', sanitizePath(props?.rootDir));
    this.codeDir = path.join(this.rootDir, sanitizePath(props?.functionProps?.codeDir));

    // Determine Lambda function type based on whether a Dockerfile path was provided
    const isContainerLambda = !!props.functionProps?.dockerFile;
    
    this.lambdaFunction = isContainerLambda
      ? this.createContainerLambdaFunction(props)
      : this.createLambdaFunction(props);

    // Handle provisioned concurrency if specified
    if (props.functionProps?.provisionedConcurrency && props.functionProps.provisionedConcurrency > 0) {
      // Provisioned concurrency requires the creation of a version and an alias
      const version = this.lambdaFunction.currentVersion;
      new Alias(this, 'LambdaAlias', {
        aliasName: 'live',
        version: version,
        provisionedConcurrentExecutions: props.functionProps.provisionedConcurrency,
      });
    }

    // Include the environment variables and secrets in the Lambda function
    if (props.functionProps?.variables && props.functionProps?.variables?.length > 0) {
      this.addEnvironmentVariables(props.functionProps?.variables || {});
    }
    if (props.functionProps?.secrets && props.functionProps?.secrets?.length > 0) {
      this.addSecrets(props.functionProps?.secrets || {});
    }

    // We want the API gateway to be accessible by the custom domain name.
    if (props.domain && props.regionalCertificateArn) {
      this.domainName = new DomainName(this, 'DomainName', {
        domainName: props.domain,
        certificate: Certificate.fromCertificateArn(this, `${this.resourceIdPrefix}-regional-certificate`, props.regionalCertificateArn),
        endpointType: EndpointType.REGIONAL,
        securityPolicy: SecurityPolicy.TLS_1_2
      });
    };

    // Create the API gateway to make the Lambda function publicly available
    this.apiGateway = this.createApiGateway(props);
    
    // Output the API Gateway URL
    new CfnOutput(this, 'ApiGatewayUrl', {
      value: this.apiGateway?.url as string,
      description: 'URL of the API Gateway',
      exportName: `${this.resourceIdPrefix}-ApiGatewayUrl`,
    });

    // Create Function URL if enabled
    if (props.functionProps?.url === true) {
      this.lambdaFunctionUrl = this.lambdaFunction.addFunctionUrl({
        authType: FunctionUrlAuthType.NONE,
      });

      // Output the Lambda function URL
      new CfnOutput(this, 'LambdaFunctionUrl', {
        value: this.lambdaFunctionUrl.url,
        description: 'URL of the Lambda function',
        exportName: `${this.resourceIdPrefix}-LambdaFunctionUrl`,
      });
    }

    // Configure API Gateway with custom domain if provided
    if (props.domain && props.regionalCertificateArn && props.hostedZoneId) {
      this.createDnsRecords(props);
    }

    // Create a scheduled rule to ping the Lambda function every 5 minutes
    if (props.functionProps?.keepWarm) {
      this.createPingRule(props);
    }

    // Output the Lambda function Name
    new CfnOutput(this, 'LambdaFunction', {
      value: this.lambdaFunction.functionName,
      description: 'Name of the Lambda function',
      exportName: `${this.resourceIdPrefix}-LambdaFunction`,
    });
  }


  /**
   * Include the specified files and directories in the Lambda function code.
   * * @param {string[]} include - The paths to include in the Lambda function code.
   * 
   * @private
   */
  private includeFilesAndDirectories(includes: string[]): void {    
    includes.forEach(file => {
      const srcFile = path.join(this.rootDir, file);
      if (fs.existsSync(srcFile)) {
        const destFile = path.join(this.codeDir, file);
        fse.copySync(srcFile, destFile);
      }
    });
  }

  /**
   * Create the container lambda function to render the app.
   * * @param {NuxtProps} props - The properties for the app.
   * * @returns {Function} The Lambda function. 
   * 
   * @private
   */
  private createContainerLambdaFunction(props: FunctionProps): Function {
    // Custom Dockerfile
    const dockerFile = props.functionProps?.dockerFile;
    if (!dockerFile) {
      throw new Error('dockerFile path is required for container Lambda functions');
    }

    const imageAsset = DockerImageCode.fromImageAsset(this.rootDir, {
      buildArgs: {
        NODE_ENV: props.environment,
        ...(Object.fromEntries(
          Object.entries(props.functionProps?.dockerBuildArgs || {}).map(([key, value]) => [key, String(value)])
        )),
      },
      file: dockerFile,
      exclude: props.functionProps?.exclude || [],
    });
    
    // Create log group for container function
    const containerLogGroup = new LogGroup(this, 'ContainerFunctionLogGroup', {
      logGroupName: `/aws/lambda/${this.resourceIdPrefix}-container-function`,
      retention: RetentionDays.ONE_MONTH,
    });

    // Create the Lambda function using the Docker image
    const lambdaFunction = new DockerImageFunction(this, "ContainerFunction", {
      functionName: `${this.resourceIdPrefix}-container-function`,
      description: `Renders the ${this.resourceIdPrefix} app.`,
      architecture: props.functionProps?.architecture || Architecture.ARM_64,
      code: imageAsset,
      timeout: props.functionProps?.timeout 
        ? Duration.seconds(props.functionProps.timeout) 
        : Duration.seconds(10),
      memorySize: props.functionProps?.memorySize || 1792,
      logGroup: containerLogGroup,
      allowPublicSubnet: false,
      tracing: props.functionProps?.tracing ? Tracing.ACTIVE : Tracing.DISABLED,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        NITRO_PRESET: 'aws-lambda',
      },
      reservedConcurrentExecutions: props.functionProps?.reservedConcurrency && props.functionProps.reservedConcurrency > 0 ? props.functionProps.reservedConcurrency : undefined,
    });

    // Add ECR permissions to the Lambda execution role
    // This ensures Lambda can pull images from ECR repositories
    if (props?.accessTokenSecretArn) {
      lambdaFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "ecr:GetAuthorizationToken",
          ],
          resources: ["*"], // GetAuthorizationToken requires * resource
        })
      );

      lambdaFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer", 
            "ecr:BatchGetImage",
            "ecr:DescribeImages",
            "ecr:DescribeRepositories",
          ],
          resources: ["*"], // Allow access to any ECR repository for flexibility
        })
      );
    }

    return lambdaFunction; 
  }

  /**
   * Create the Lambda function
   * 
   * @private
   */
  private createLambdaFunction(props: FunctionProps): Function {
    // Include the specified files and directories to output directory
    if (props.functionProps?.include && props.functionProps?.include.length > 0) {
      this.includeFilesAndDirectories(props.functionProps?.include);
    }

    // Create log group for function
    const functionLogGroup = new LogGroup(this, 'FunctionLogGroup', {
      logGroupName: `/aws/lambda/${this.resourceIdPrefix}-function`,
      retention: RetentionDays.ONE_MONTH,
    });

    // Create the Lambda function
    const lambdaFunction = new Function(this, 'Function', {
      functionName: `${this.resourceIdPrefix}-function`,
      description: `Lambda function for ${this.resourceIdPrefix}`,
      runtime: props.functionProps?.runtime || Runtime.NODEJS_20_X,
      architecture: props.functionProps?.architecture || Architecture.ARM_64,
      handler: props.functionProps?.handler || 'index.handler',
      code: Code.fromAsset(this.codeDir, {
        exclude: props.functionProps?.exclude || ['**/*.svg', '**/*.ico', '**/*.png', '**/*.jpg', '**/*.js.map'],
      }),
      timeout: props.functionProps?.timeout 
        ? Duration.seconds(props.functionProps.timeout) 
        : Duration.seconds(10),
      memorySize: props.functionProps?.memorySize || 1792,
      logGroup: functionLogGroup,
      tracing: props.functionProps?.tracing ? Tracing.ACTIVE : Tracing.DISABLED,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        NITRO_PRESET: 'aws-lambda',
      },
      reservedConcurrentExecutions: props.functionProps?.reservedConcurrency && props.functionProps.reservedConcurrency > 0 ? props.functionProps.reservedConcurrency : undefined,
      layers: props.functionProps?.bunLayerArn
        ? [LayerVersion.fromLayerVersionArn(this, 'BunLayer', props.functionProps.bunLayerArn)]
        : [],
    });

    return lambdaFunction;
  }

  /**
   * Add environment variables to the Lambda function.
   * @param {Record<string, string>} envVars - The environment variables to add.
   * 
   * @private
   */
  private addEnvironmentVariables(envVars: Array<{ [key: string]: string }>): void {
    envVars.forEach(envVar => {
      Object.entries(envVar).forEach(([key, value]) => {
        this.lambdaFunction.addEnvironment(key, value);
      });
    });
  }

  /**
   * Add secrets from AWS Secrets Manager to the Lambda function environment.
   * @param secrets Array of objects with { key, resource } where resource is the ARN of the secret.
   *
   * @private
   */
  private addSecrets(secrets: Array<{ key: string; resource: string }>): void {
    secrets.forEach(secret => {
      const importedSecret = Secret.fromSecretCompleteArn(
        this,
        `Secret-${secret.key}`,
        secret.resource
      );

      // Add the secret value as an environment variable
      this.lambdaFunction.addEnvironment(secret.key, importedSecret.secretValue.unsafeUnwrap());

      // Grant Lambda permission to read the secret
      importedSecret.grantRead(this.lambdaFunction);
    });
  }

  /**
   * Creates the API gateway to make the Nuxt app render Lambda function publicly available.
   *
   * @private
   */
  private createApiGateway(props: FunctionProps): HttpApi {
    const lambdaIntegration = new HttpLambdaIntegration(`${this.resourceIdPrefix}-lambda-integration`, this.lambdaFunction);

    const apiGateway = new HttpApi(this, "API", {
      apiName: `${this.resourceIdPrefix}-api`,
      description: `Makes ${this.resourceIdPrefix} Lambda function publicly available.`,
      // The app does not allow any cross-origin access by purpose: the app should not be embeddable anywhere
      corsPreflight: undefined,
      defaultIntegration: lambdaIntegration,
      createDefaultStage: true,
      ...(this.domainName && { defaultDomainMapping: { domainName: this.domainName } })
    });

    apiGateway.addRoutes({
      integration: lambdaIntegration,
      path: '/{proxy+}',
      methods: [HttpMethod.GET, HttpMethod.HEAD],
    });

    return apiGateway;
  }

  /**
   * Create the API Gateway and custom domain if provided
   * 
   * @private
   */
  private createDnsRecords(props: FunctionProps): void {
    // Import hosted zone
    const domainParts = props.domain?.split('.') as string[];

    const hostedZone = HostedZone.fromHostedZoneAttributes(this, `${this.resourceIdPrefix}-hosted-zone`, {
        hostedZoneId: props.hostedZoneId as string,
        zoneName: domainParts[domainParts.length - 1] // Support subdomains
    });

    // Create an ARecord and AaaaRecord for the domain and API Gateway
    const dnsTarget = RecordTarget.fromAlias({
      bind: () => ({
        dnsName: this.domainName?.regionalDomainName,
        hostedZoneId: this.domainName?.regionalHostedZoneId,
      }),
    });

    new ARecord(this, `${this.resourceIdPrefix}-ipv4-record`, {
      recordName: props.domain,
      zone: hostedZone,
      target: dnsTarget
    });

    new AaaaRecord(this, `${this.resourceIdPrefix}-ipv6-record`, {
      recordName: props.domain,
      zone: hostedZone,
      target: dnsTarget
    });
  }

  /**
   * Creates a scheduled rule to ping Lambda function every 5 minutes in order to keep it warm
   * and speed up initial SSR requests.
   *
   * @private
   */
  private createPingRule(props: FunctionProps): void {
    const fakeApiGatewayEventData = {
        "version": "2.0",
        "routeKey": "GET /{proxy+}",
        "rawPath": "/",
        "rawQueryString": "",
        "headers": {},
        "requestContext": {
            "http": {
                "method": "GET",
                "path": "/",
                "protocol": "HTTP/1.1"
            }
        }
    };

    new Rule(this, `PingRule`, {
        ruleName: `${this.resourceIdPrefix}-pinger`,
        description: `Pings the Lambda function of the ${this.resourceIdPrefix} app every 5 minutes to keep it warm.`,
        enabled: true,
        schedule: Schedule.rate(Duration.minutes(5)),
        targets: [new LambdaFunction(this.lambdaFunction, {
            event: RuleTargetInput.fromObject(fakeApiGatewayEventData)
        })],
    });
  }
}