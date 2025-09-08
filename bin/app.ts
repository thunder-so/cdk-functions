import { App } from "aws-cdk-lib";
import { FunctionStack, type FunctionProps } from '../';

const app = new App();

const metadata: FunctionProps = app.node.tryGetContext('metadata');

if (!metadata) {
  throw new Error('Context metadata missing!');
}

new FunctionStack(app, `${metadata.application}-${metadata.service}-${metadata.environment}-stack`, metadata);

app.synth();
