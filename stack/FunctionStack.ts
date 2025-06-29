import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { FunctionsConstruct, PipelineConstruct } from '../lib';
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

    const fn = new FunctionsConstruct(this, 'Functions', props);

    /**
     * Pipeline enabled and GitHub access token provided
     * 
     */ 
    if (props?.accessTokenSecretArn) {
      // check for sourceProps
      if (!props.sourceProps?.owner || !props.sourceProps?.repo || !props.sourceProps?.branchOrRef) {
        throw new Error('Missing sourceProps: Github owner, repo and branch/ref required.');
      }

      // check for buildProps
      if (!props.buildProps?.runtime || !props.buildProps?.runtime_version || !props.buildProps?.installcmd || !props.buildProps?.buildcmd) {
        throw new Error('Missing buildProps: runtime, runtime_version, installcmd, buildcmd and outputdir required when pipeline is enabled.');
      }

      new PipelineConstruct(this, 'Pipeline', {
        ...props,
        lambdaFunction: fn.lambdaFunction
      });
    }; // end if

  }
}