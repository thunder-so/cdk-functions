import {type StackProps} from "aws-cdk-lib";
import { Runtime, Architecture} from 'aws-cdk-lib/aws-lambda';

export interface FunctionProps extends StackProps {

    /**
     * Debug
     */
    readonly debug?: boolean;

    /**
     * The AWS environment (account/region) where this stack will be deployed.
     */
    readonly env: {
      // The ID of your AWS account on which to deploy the stack.
      account: string;
  
      // The AWS region where to deploy the app.
      region: string;
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
     
    /**
     * Configure the Lambda function
     */
    readonly functionProps: {
      readonly url?: boolean;
      readonly runtime?: Runtime;
      readonly architecture?: Architecture;
      readonly codeDir?: string;
      readonly handler?: string;
      readonly include?: string[];
      readonly exclude?: string[];
      readonly memorySize?: number;
      readonly timeout?: number;
      readonly tracing?: boolean;
      readonly reservedConcurrency?: number;
      readonly provisionedConcurrency?: number;
      readonly variables?: Array<{ [key: string]: string; }>;
      /**
       * Create a secret with AWS Secrets Manager and pass them to the Lambda function as environment variables.
       * The library will create permission for Lambda to access the secret value.
       * 
       *   secrets: [
       *     { key: 'PUBLIC_EXAMPLE', resource: 'your-secret-arn' }
       *   ]
       */
      readonly secrets?: { key: string; resource: string; }[];
      readonly dockerFile?: string;
      readonly dockerBuildArgs?: string[];
      /**
       * Enable Bun runtime for Lambda. Provide a Bun Lambda Layer ARN.
       * Provide ARN of the Bun Lambda Layer to use for the function.
      * See: https://github.com/oven-sh/bun/tree/main/packages/bun-lambda
       */
      readonly bunLayerArn?: string;
    }

    /**
     * Domains with Route53 and ACM
     */

    // Optional. The domain (without the protocol) at which the app shall be publicly available.
    readonly domain?: string;
  
    // Optional. The ARN of the regional certificate to use with API Gateway.
    readonly regionalCertificateArn?: string;
  
    // Optional. The ID of the hosted zone to create a DNS record for the specified domain.
    readonly hostedZoneId?: string;

}