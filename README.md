# CDK-Functions

<p>
    <a href="https://github.com/thunder-so/cdk-functions/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/thunder-so/cdk-functions/publish.yml?logo=github" /></a>
    <a href="https://www.npmjs.com/package/@thunderso/cdk-functions"><img alt="Version" src="https://img.shields.io/npm/v/@thunderso/cdk-functions.svg" /></a>
    <a href="https://www.npmjs.com/package/@thunderso/cdk-functions"><img alt="Downloads" src="https://img.shields.io/npm/dm/@thunderso/cdk-functions.svg"></a>
    <a href="https://www.npmjs.com/package/@thunderso/cdk-functions"><img alt="License" src="https://img.shields.io/npm/l/@thunderso/cdk-functions.svg" /></a>
</p>

The easiest way to deploy an API on AWS Lambda with modern web frameworks. 

Supported frameworks:

- [Express.js](https://expressjs.com/)
- [Hono](https://hono.dev/)
- [Fastify](https://www.fastify.io/)
- [Koa](https://koajs.com/)
- [NestJS](https://nestjs.com/)
- [AdonisJS](https://adonisjs.com/)
- [Sails.js](https://sailsjs.com/)
- [LoopBack](https://loopback.io/)
- [Feathers](https://feathersjs.com/)
- [Restify](http://restify.com/)
- Any web application framework

AWS resources:

- Server-side logic with [AWS Lambda](https://aws.amazon.com/lambda/) for dynamic content and API handling
- Publicly available by a custom domain (or subdomain) via [Route53](https://aws.amazon.com/route53/) and SSL via [Certificate Manager](https://aws.amazon.com/certificate-manager/)
- [Amazon API Gateway](https://aws.amazon.com/api-gateway/) for creating, deploying, and managing secure APIs at any scale.
- Environment variables can be securely stored and managed using [AWS Systems Manager Parameter Store](https://aws.amazon.com/systems-manager/features/#Parameter_Store).
- Build and deploy with [Github Actions](https://docs.github.com/en/actions)


## Prerequisites

You need an [AWS account](https://aws.amazon.com/premiumsupport/knowledge-center/create-and-activate-aws-account/) to create and deploy the required resources for the site on AWS.

Before you begin, make sure you have the following:
  - Node.js and npm: Ensure you have Node.js (v18 or later) and npm installed.
  - AWS CLI: Install and configure the AWS Command Line Interface.

  - AWS CDK: Install the AWS CDK globally
```
npm install -g aws-cdk
```

  - Before deploying, bootstrap your AWS environment:
```
cdk bootstrap aws://your-aws-account-id/us-east-1
```

This package uses the `npm` package manager and is an ES6+ Module.

## Installation

Navigate to your project directory and install the package and its required dependencies. 

Your `package.json` must also contain `tsx` and this specific version of `aws-cdk-lib`:

```bash
npm i tsx aws-cdk-lib@2.150.0 @thunderso/cdk-functions --save-dev
```


## Setup

1. Login into the AWS console and note the `Account ID`. You will need it in the configuration step.

2. Run the following commands to create the required CDK stack entrypoint at `stack/index.ts`. 

```bash
mkdir stack
cd stack
touch index.ts 
```

You should adapt the file to your project's needs.

> [!NOTE]
> Use different filenames such as `production.ts` and `dev.ts` for environments.

## Configuration

```ts
//stack/index.ts
import { App } from "aws-cdk-lib";
import { FunctionStack, type FunctionProps } from '@thunderso/cdk-functions';

const fnStackProps: FunctionProps = {

  // Set your AWS environment
  env: {
    account: 'your-account-id',
    region: 'us-east-1',
  },
  
  // Label your infrastructure
  application: 'your-application-id',
  service: 'your-service-id',
  environment: 'dev',

  // Configure the function
  functionProps: {
    codeDir: 'dist',
    handler: 'index.handler',
  },

};

new FunctionStack(new App(), 
    `${fnStackProps.application}-${fnStackProps.service}-${fnStackProps.environment}-stack`, 
    fnStackProps
);
```

## Deploy

By running the following script, the CDK stack will be deployed to AWS.

```bash
npx cdk deploy --require-approval never --all --app="npx tsx stack/index.ts" 
```

## Destroy the Stack

If you want to destroy the stack and all its resources (including storage, e.g., access logs), run the following script:

```bash
npx cdk destroy --require-approval never --all --app="npx tsx stack/index.ts" 
```


# Deploy using GitHub Actions

In your GitHub repository, add a new workflow file under `.github/workflows/deploy.yml` with the following content:

```yaml .github/workflows/deploy.yml
name: Deploy Function to AWS

on:
  push:
    branches:
      - main  # or the branch you want to deploy from

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Install dependencies
        run: npm ci

      - name: Build application
        run: npm run build

      - name: Deploy to AWS
        run: |
          npx cdk deploy --require-approval never --all --app="npx tsx stack/index.ts"
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: 'us-east-1'  # or your preferred region
```

Add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as repository secrets in GitHub. These should be the access key and secret for an IAM user with permissions to deploy your stack.


# Manage Domain with Route53

1. [Create a hosted zone in Route53](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/AboutHZWorkingWith.html) for the desired domain, if you don't have one yet.

  This is required to create DNS records for the domain to make the app publicly available on that domain. On the hosted zone details you should see the `Hosted zone ID` of the hosted zone.

2. [Request a public regional certificate in the AWS Certificate Manager (ACM)](https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-request-public.html) for the desired domain in the same region as the function and validate it, if you don't have one yet.

  This is required to provide the app via HTTPS on the public internet. Take note of the displayed `ARN` for the certificate. 

> [!IMPORTANT]
> The certificate must be issued in the same region as the function.

```ts
// stack/index.ts
const fnStackProps: FunctionProps = {
  // ... other props

  domain: 'api.example.com',
  hostedZoneId: 'XXXXXXXXXXXXXXX',
  regionalCertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abcd1234-abcd-1234-abcd-1234abcd1234',
};
```

# Using environment variables

Create a secure parameter in SSM Parameter Store:

```bash
aws ssm put-parameter --name "/my-app/API_KEY" --type "SecureString" --value "your-secret-api-key"
```

Pass environment variables to your lambda function to inject secrets. The library automatically adds the necessary permissions to the Lambda function's role to read parameters from SSM Parameter Store.

```ts
// stack/index.ts
const appStackProps: SPAProps = {
  // ... other props

  environmentVariables: [
    { key: 'API_URL', resource: '/my-app/API_URL' },
    { key: 'API_KEY', resource: '/my-app/API_KEY' },
  ],

};
```

# Configure the Lambda

Each configuration property provides a means to fine-tune your function’s performance and operational characteristics.

```ts
// stack/index.ts
import { App } from "aws-cdk-lib";
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { FunctionStack, type FunctionProps } from '@thunderso/cdk-functions';

const fnStackProps: FunctionProps = {
  // ... other props
  
  functionProps: {
    url: true,
    runtime: Runtime.NODEJS_20_X,
    architecture: Architecture.ARM_64,
    codeDir: 'dist',
    handler: 'index.handler',
    memorySize: 1792,
    timeout: 10,
    tracing: true,
    exclude: ['**/*.ts', '**/*.map'],
  },

};

new FunctionStack(new App(), 
    `${fnStackProps.application}-${fnStackProps.service}-${fnStackProps.environment}-stack`, 
    fnStackProps
);
```

### `url`
Specifies whether to enable Lambda function URL.
- **Type**: `boolean`
- **Default**: Defaults to `url: true`.

### `runtime`
Specifies the runtime environment for the Lambda function, determining which Lambda runtime API versions are available to the function.
- **Type**: `Runtime`
- **Examples**: `Runtime.NODEJS_20_X`, `Runtime.PYTHON_3_8`
- **Default**: The runtime defaults to `Runtime.NODEJS_20_X`.

### `architecture`
Defines the instruction set architecture that the Lambda function supports.
- **Type**: `Architecture`
- **Examples**: `Architecture.ARM_64`, `Architecture.X86_64`
- **Default**: The architecture defaults to `Architecture.ARM_64`.

### `codeDir`
Indicates the directory containing the Lambda function code.
- **Type**: `string`
- **Usage Example**: `codeDir: 'dist'`
- **Default**: `codeDir: ''`.

### `handler`
Specifies the function within your code that Lambda calls to start executing your function.
- **Type**: `string`
- **Usage Example**: `handler: 'index.handler'`
- **Default**: `handler: 'index.handler'`

### `exclude`
Lists the file patterns that should be excluded from the Lambda deployment package.
- **Type**: `string[]`
- **Usage Example**: `exclude: ['*.test.js', 'README.md']`

### `memorySize`
The amount of memory, in MB, allocated to the Lambda function.
- **Type**: `number`
- **Default**: 1792 MB
- **Usage Example**: `memorySize: 512`

### `timeout`
The function execution time (in seconds) after which Lambda will terminate the running function.
- **Type**: `number`
- **Default**: 10 seconds
- **Usage Example**: `timeout: 15`

### `tracing`
Enables or disables AWS X-Ray tracing for the Lambda function.
- **Type**: `boolean`
- **Default**: `false`
- **Usage Example**: `tracing: true`


# Advanced: Scaling Properties

When configuring AWS Lambda functions, understanding scaling properties is essential for efficient resource management and cost optimization. The two primary scaling properties you can configure are `reservedConcurrency` and `provisionedConcurrency`.

```ts
// stack/index.ts
import { App } from "aws-cdk-lib";
import { FunctionStack, type FunctionProps } from '@thunderso/cdk-functions';

const fnStackProps: FunctionProps = {
  // ... other props
  
  functionProps: {
    // ... other props
    reservedConcurrency: 5,
    provisionedConcurrency: 10,
  },

};

new FunctionStack(new App(), 
    `${fnStackProps.application}-${fnStackProps.service}-${fnStackProps.environment}-stack`, 
    fnStackProps
);
```

### `reservedConcurrency`
Reserved concurrency sets a limit on the number of instances of the function that can run simultaneously. It ensures that your function has access to a specified amount of concurrent executions, preventing it from being throttled if account-level concurrency limits are reached.
- **Use Case**: This is useful when you want to have predictable execution patterns or ensure other functions don't consume all available concurrency.
- **Example**: `reservedConcurrency: 5`

### `provisionedConcurrency`
Provisioned concurrency keeps a set of pre-initialized environments ready to respond immediately to incoming requests. This helps in reducing latency and eliminating cold starts when the function is triggered.
- **Use Case**: Ideal for latency-sensitive applications where response time is critical.
- **Example**: `provisionedConcurrency: 10`

While both reserved and provisioned concurrency deal with execution limits, they serve different purposes. Reserved concurrency guarantees a portion of the total function pool across your AWS account, while provisioned concurrency is specifically about warming up a set number of function instances to achieve low-latency execution.
