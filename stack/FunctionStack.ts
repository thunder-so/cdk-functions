import { Stack, RemovalPolicy } from 'aws-cdk-lib';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { FunctionsConstruct, PipelineConstruct, EventsConstruct } from '../lib';
import type { FunctionProps } from './FunctionProps'; 

export class FunctionStack extends Stack {
  constructor(scope: Construct, id: string, props?: FunctionProps) {
    super(scope, id, props);

    // Check mandatory properties
    if (!props?.env) {
      throw new Error('Must provide AWS account and region.');
    }
    if (!props.application || !props.environment || !props.service) {
      throw new Error('Mandatory stack properties missing.');
    }

    const resourceIdPrefix = `${props.application}-${props.service}-${props.environment}`.substring(0, 42);

    // ECR repository
    const ecr = new Repository(this, "Repository", {
      repositoryName: `${resourceIdPrefix}-repository`,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    const fn = new FunctionsConstruct(this, 'Functions', {
      ...props,
      repository: ecr
    });

    /**
     * GitHub access token provided, enable pipeline
     * 
     */ 
    if (props?.accessTokenSecretArn) {
      // check for sourceProps
      if (!props.sourceProps?.owner || !props.sourceProps?.repo || !props.sourceProps?.branchOrRef) {
        throw new Error('Missing sourceProps: Github owner, repo and branch/ref required.');
      }

      const pipeline = new PipelineConstruct(this, 'Pipeline', {
        ...props,
        repository: ecr,
        lambdaFunction: fn.lambdaFunction
      });

      // Pipeline events
      if (props.eventTarget) {
        new EventsConstruct(this, 'PipelineEvents', {
          ...props,
          codePipeline: pipeline.codePipeline,
        });
      }
    }; // end if

  }
}