import { type StackProps } from "aws-cdk-lib";
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';

export interface PipelineProps {
  /**
   * Enable pipeline mode with Github Access Token stored as a secret in SSM Secret Manager.
   * Provide the ARN to your Secrets Manager secret.
   */
  readonly accessTokenSecretArn?: string;

  /**
   * Configure your Github repository
   */
  readonly sourceProps?: {
    readonly owner?: string;
    readonly repo?: string;
    readonly branchOrRef?: string;
  };

  /**
   * The properties for CodeBuild build process.
   */
  readonly buildProps?: {
    readonly runtime?: string;
    readonly runtime_version?: string|number;
    readonly installcmd?: string;
    readonly buildcmd?: string;
    readonly include?: string[];
    readonly exclude?: string[];
    readonly environment?: Array<{ [key: string]: string; }>;
    readonly secrets?: { key: string; resource: string; }[];
    /**
     * Optional. Path to a custom Dockerfile for the build environment.
     * Example: 'runtime/Dockerfile'
     */
    readonly customRuntime?: string;
  };

  /**
   * If you have a custom buildspec.yml file for your app, provide the relative path to the file.
   */
  readonly buildSpecFilePath?: string;

  /**
   * The ARN of the Event Bus.
   * - The pipeline events are broadcast to an event bus. Defaults to null.
   */
  readonly eventTarget?: string;
}

/**
 * Lambda function configuration properties
 */
export interface LambdaProps {
  /**
   * Enable Lambda URL
   */
  readonly url?: boolean;
  /**
   * Lambda runtime (e.g., nodejs, python)
   */
  readonly runtime?: Runtime;
  /**
   * Lambda architecture (e.g., x86_64, arm64)
   */
  readonly architecture?: Architecture;
  /**
   * Directory containing Lambda code
   */
  readonly codeDir?: string;
  /**
   * Lambda handler (e.g., index.handler)
   */
  readonly handler?: string;
  /**
   * Files to include in deployment
   */
  readonly include?: string[];
  /**
   * Files to exclude from deployment
   */
  readonly exclude?: string[];
  /**
   * Memory size (MB)
   */
  readonly memorySize?: number;
  /**
   * Timeout (seconds)
   */
  readonly timeout?: number;
  /**
   * Enable X-Ray tracing
   */
  readonly tracing?: boolean;
  /**
   * Reserved concurrency
   */
  readonly reservedConcurrency?: number;
  /**
   * Provisioned concurrency
   */
  readonly provisionedConcurrency?: number;
  /**
   * Environment variables for Lambda
   */
  readonly variables?: Array<{ [key: string]: string }>;
  /**
   * Create a secret with AWS Secrets Manager and pass them to the Lambda function as environment variables.
   * The library will create permission for Lambda to access the secret value.
   * 
   *   secrets: [
   *     { key: 'PUBLIC_EXAMPLE', resource: 'your-secret-arn' }
   *   ]
   */
  readonly secrets?: { key: string; resource: string }[];
  /**
   * Path to Dockerfile for Lambda deployment
   */
  readonly dockerFile?: string;
  /**
   * Docker build arguments
   */
  readonly dockerBuildArgs?: string[];
  /**
   * Enable Bun runtime for Lambda. Provide a Bun Lambda Layer ARN.
   * See: https://github.com/oven-sh/bun/tree/main/packages/bun-lambda
   */
  readonly bunLayerArn?: string;
  /**
   * Keep the Lambda warm by invoking it every 5 minutes.
   */
  readonly keepWarm?: boolean;
}

/**
 * Domain and certificate properties
 */
export interface DomainProps {
  /**
   * Optional. The domain (without the protocol) at which the app shall be publicly available.
   */
  readonly domain?: string;
  /**
   * Optional. The ARN of the regional certificate to use with API Gateway.
   */
  readonly regionalCertificateArn?: string;
  /**
   * Optional. The ID of the hosted zone to create a DNS record for the specified domain.
   */
  readonly hostedZoneId?: string;
}

/**
 * Application identity and environment properties
 */
export interface AppProps extends StackProps {
  /**
   * Debug
   */
  readonly debug?: boolean;
  /**
   * Optional: directory containing the context for deployment
   * Used for deployments with cdk.context.json
   */
  readonly contextDirectory?: string;
  /**
   * The AWS environment (account/region) where this stack will be deployed.
   */
  readonly env: {
    /**
     * The ID of your AWS account on which to deploy the stack.
     */
    readonly account: string;
    /**
     * The AWS region where to deploy the app.
     */
    readonly region: string;
  };
  /**
   * A string identifier for the project the app is part of.
   */
  readonly application: string;
  /**
   * A string identifier for the project's service the app is created for.
   */
  readonly service: string;
  /**
   * A string to identify the environment of the app.
   */
  readonly environment: string;
  /**
   * The path to the root directory of the app (at which the `package.json` file is located).
   * Defaults to '.'.
   */
  readonly rootDir?: string;
}

/**
 * Main FunctionProps interface, composed of all prop groups
 */
export interface FunctionProps
  extends PipelineProps,
    DomainProps, 
    AppProps {
      readonly functionProps: LambdaProps;
    }