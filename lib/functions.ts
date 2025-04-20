import { Aws, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Function, FunctionUrl, Runtime, Code, Alias, Architecture, Tracing, FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LambdaRestApi } from 'aws-cdk-lib/aws-apigateway';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { ARecord, AaaaRecord, RecordTarget, HostedZone } from 'aws-cdk-lib/aws-route53';
import { ApiGatewayDomain } from 'aws-cdk-lib/aws-route53-targets';

export interface FunctionsProps {
  readonly debug?: boolean;
  readonly application: string;
  readonly service: string;
  readonly environment: string;
  readonly sourceProps?: {
    rootDir?: string;
  };
  readonly functionProps?: {
    url?: boolean;
    runtime?: Runtime;
    architecture?: Architecture;
    codeDir: string;
    handler?: string;
    exclude?: string[];
    memorySize?: number;
    timeout?: number;
    tracing?: boolean;
    reservedConcurrency?: number;
    provisionedConcurrency?: number;
  };
  readonly environmentVariables?: { key: string; resource: string; }[];
  readonly domain?: string;
  readonly regionalCertificateArn?: string;
  readonly hostedZoneId?: string;
}

export class FunctionsConstruct extends Construct {
  private readonly resourceIdPrefix: string;
  public lambdaFunction: Function;
  public lambdaFunctionUrl: FunctionUrl;
  public APIGateway: LambdaRestApi;

  constructor(scope: Construct, id: string, props: FunctionsProps) {
    super(scope, id);

    // Set the resource prefix
    this.resourceIdPrefix = `${props.application}-${props.service}-${props.environment}`.substring(0, 42);

    // Create the Lambda function
    this.lambdaFunction = this.createLambdaFunction(props);

    // Enable Function URL if specified
    // default is true; only false if explicitly set to false
    if (props.functionProps?.url !== false) {
      this.lambdaFunctionUrl = this.lambdaFunction.addFunctionUrl({
        authType: FunctionUrlAuthType.NONE,
      });

      // Output the Lambda function URL
      new CfnOutput(this, 'LambdaUrl', {
        value: this.lambdaFunctionUrl.url,
        description: 'URL of the Lambda function',
        exportName: `${this.resourceIdPrefix}-LambdaFunctionUrl`,
      });
    }

    // Configure API Gateway with custom domain if provided
    if (props.domain && props.regionalCertificateArn && props.hostedZoneId) {
      this.createDnsRecords(props);

      // Output the API Gateway URL
      new CfnOutput(this, 'ApiGatewayUrl', {
        value: this.APIGateway.url,
        description: 'URL of the API Gateway',
        exportName: `${this.resourceIdPrefix}-ApiGatewayUrl`,
      });
    }

    // Output the Lambda function Name
    new CfnOutput(this, 'Lambda', {
      value: this.lambdaFunction.functionName,
      description: 'Name of the Lambda function',
      exportName: `${this.resourceIdPrefix}-LambdaFunction`,
    });
  }

  /**
   * Create the Lambda function
   */
  private createLambdaFunction(props: FunctionsProps): Function {
    // Create the Lambda function
    const codeDirectory = `${props.sourceProps?.rootDir || '.'}/${props.functionProps?.codeDir || ''}`;

    const lambdaFunction = new Function(this, 'Function', {
      functionName: `${this.resourceIdPrefix}-Function`,
      description: `Lambda function for ${this.resourceIdPrefix}`,
      runtime: props.functionProps?.runtime || Runtime.NODEJS_20_X,
      architecture: props.functionProps?.architecture || Architecture.ARM_64,
      handler: props.functionProps?.handler || 'index.handler',
      code: Code.fromAsset(codeDirectory, {
        exclude: props.functionProps?.exclude || ['**/*.svg', '**/*.ico', '**/*.png', '**/*.jpg', '**/*.js.map'],
      }),
      memorySize: props.functionProps?.memorySize || 1792,
      timeout: props.functionProps?.timeout 
        ? Duration.seconds(props.functionProps.timeout) 
        : Duration.seconds(10),
      logRetention: RetentionDays.ONE_MONTH,
      tracing: props.functionProps?.tracing ? Tracing.ACTIVE : Tracing.DISABLED,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
      },
      reservedConcurrentExecutions: props.functionProps?.reservedConcurrency
    });

    // Handle provisioned concurrency if specified
    if (props.functionProps?.provisionedConcurrency !== undefined) {
      // Provisioned concurrency requires the creation of a version and an alias
      const version = lambdaFunction.currentVersion;
      new Alias(this, 'LambdaAlias', {
        aliasName: 'live',
        version: version,
        provisionedConcurrentExecutions: props.functionProps.provisionedConcurrency,
      });
    }

    // Add environment variables from environmentVariables
    if (props.environmentVariables && props.environmentVariables.length > 0) {
      for (const envVar of props.environmentVariables) {
        const parameter = StringParameter.fromSecureStringParameterAttributes(this, `EnvVar-${envVar.key}`, {
          parameterName: envVar.resource,
        });
        lambdaFunction.addEnvironment(envVar.key, parameter.stringValue);

        // Grant permission to read the parameter
        parameter.grantRead(lambdaFunction);
      }

      // IAM policy to access parameters
      lambdaFunction.addToRolePolicy(new PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: props.environmentVariables.map(envVar => `arn:aws:ssm:${Aws.REGION}:${Aws.ACCOUNT_ID}:parameter${envVar.resource}`),
      }));
    }

    return lambdaFunction;
  }

  /**
   * Create the API Gateway and custom domain if provided
   */
  private createDnsRecords(props: FunctionsProps): void {
    // API Gateway
    this.APIGateway = new LambdaRestApi(this, `${this.resourceIdPrefix}-API`, {
      handler: this.lambdaFunction,
      deployOptions: {
        stageName: props.environment,
        dataTraceEnabled: props.debug,
        metricsEnabled: props.debug,
        tracingEnabled: props.debug,
      },
    });

    // Import hosted zone
    const domainParts = props.domain?.split('.') as string[];

    const hostedZone = HostedZone.fromHostedZoneAttributes(this, `${this.resourceIdPrefix}-hosted-zone`, {
        hostedZoneId: props.hostedZoneId as string,
        zoneName: domainParts[domainParts.length - 1] // Support subdomains
    });

    // Import existing certificate
    const certificate = Certificate.fromCertificateArn(this, `${this.resourceIdPrefix}-Certificate`, props.regionalCertificateArn as string);

    // Add custom domain name to API Gateway
    const domainName = this.APIGateway.addDomainName(`${this.resourceIdPrefix}-Domain`, {
      domainName: props.domain as string,
      certificate,
    });

    // Create an ARecord and AaaaRecord for the domain and API Gateway
    const dnsTarget = RecordTarget.fromAlias(new ApiGatewayDomain(domainName));

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
}