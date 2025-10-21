import { App } from "aws-cdk-lib";
import { FunctionStack, type FunctionProps } from '../';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';

const app = new App();

const rawMetadata: any = app.node.tryGetContext('metadata');

if (!rawMetadata) {
  throw new Error('Context metadata missing!');
}

function mapRuntime(rt?: string | Runtime): Runtime | undefined {
  if (!rt) return undefined;
  if ((rt as any)?.constructor && (rt as any).constructor.name === 'Runtime') return rt as Runtime;
  const s = String(rt).toLowerCase();
  if (s === 'provided') return Runtime.PROVIDED_AL2023;
  if (s.startsWith('nodejs')) {
    if (s.includes('20')) return Runtime.NODEJS_20_X;
    if (s.includes('18')) return Runtime.NODEJS_18_X;
  }
  // Unknown runtime string: return undefined so construct can fall back to defaults
  console.warn(`Unrecognized runtime string in context: "${rt}" — using stack defaults`);
  return undefined;
}

function mapArch(a?: string | Architecture): Architecture | undefined {
  if (!a) return undefined;
  if ((a as any)?.constructor && (a as any).constructor.name === 'Architecture') return a as Architecture;
  const s = String(a).toLowerCase();
  if (s === 'arm' || s === 'arm64') return Architecture.ARM_64;
  if (s === 'x86' || s === 'x86_64' || s === 'x64') return Architecture.X86_64;
  console.warn(`Unrecognized architecture string in context: "${a}" — using stack defaults`);
  return undefined;
}

// Clone metadata and apply mappings
const mappedRuntime = mapRuntime(rawMetadata.functionProps?.runtime as any);
const mappedArch = mapArch(rawMetadata.functionProps?.architecture as any);

const metadata: FunctionProps = {
  ...rawMetadata,
  functionProps: {
    ...rawMetadata.functionProps,
    ...(mappedRuntime && { runtime: mappedRuntime }),
    ...(mappedArch && { architecture: mappedArch })
  }
};

new FunctionStack(app, `${metadata.application}-${metadata.service}-${metadata.environment}-stack`, metadata);

app.synth();
