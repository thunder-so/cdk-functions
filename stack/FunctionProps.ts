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
      url?: boolean;
      runtime?: Runtime;
      architecture?: Architecture;
      codeDir?: string;
      handler?: string;
      exclude?: string[];
      memorySize?: number;
      timeout?: number;
      tracing?: boolean;
      reservedConcurrency?: number;
      provisionedConcurrency?: number;
    }

    /**
     * Create Parameter Store variables as plaintext and pass them to the Lambda function as environment variables.
     * The Lambda function will have access to the parameter store variables as environment variables.
     * Must be in the same region as your stack.
     * 
     *   environmentVariables: [
     *     { key: 'PUBLIC_EXAMPLE', resource: '/path-to/your-parameter' }
     *   ]
     */
    readonly environmentVariables?: { 
      key: string; 
      resource: string; 
    }[];
   

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