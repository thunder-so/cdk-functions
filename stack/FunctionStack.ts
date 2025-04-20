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

    // Sanitize paths to remove leading and trailing slashes
    const sanitizePath = (path: string | undefined): string => {
      if (!path) return '';
      return path.replace(/^\/+|\/+$/g, '');
    };

    const rootDir = sanitizePath(props.sourceProps?.rootDir);
    const codeDir = sanitizePath(props.functionProps?.codeDir);

    new FunctionsConstruct(this, 'Functions', {
      debug: props.debug, 
      application: props.application,
      service: props.service,
      environment: props.environment,
      sourceProps: {
        rootDir: rootDir,
      },
      functionProps: {
        url: props.functionProps?.url,
        runtime: props.functionProps?.runtime,
        architecture: props.functionProps?.architecture,
        codeDir: codeDir,
        handler: props.functionProps?.handler,
        exclude: props.functionProps?.exclude,
        memorySize: props.functionProps?.memorySize,
        timeout: props.functionProps?.timeout,
        tracing: props.functionProps?.tracing,
        reservedConcurrency: props.functionProps?.reservedConcurrency,
        provisionedConcurrency: props.functionProps?.provisionedConcurrency,
      },
      environmentVariables: props.environmentVariables,
      domain: props.domain,
      regionalCertificateArn: props.regionalCertificateArn,
      hostedZoneId: props.hostedZoneId
    });

  }
}