import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { FunctionsConstruct } from '../lib';
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

    new FunctionsConstruct(this, 'Functions', props);
  }
}