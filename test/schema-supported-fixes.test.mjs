import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { validateSchema } from '../archify/renderers/shared/validator.mjs';

// Loaded per test so the validateSchema regressions below still run, and fail on
// their assertions, against a validator that predates this export.
const supportedFixesFor = async (...args) =>
  (await import('../archify/renderers/shared/validator.mjs')).supportedFixesFor(...args);

// ajv is installed under archify/, so resolve it from there. These are the same
// options the generated validators use, so the error params match the real pipeline.
const require = createRequire(new URL('../archify/package.json', import.meta.url));
const Ajv2020 = require('ajv/dist/2020.js').default;

// No existing test file covers the validator's supportedFixes mapping directly,
// so these regressions live together here. Each case mutates a shipped example
// and asserts the diagnostic carries a concrete repair, not an empty list.
const example = (name) => JSON.parse(fs.readFileSync(new URL(`../archify/examples/${name}`, import.meta.url), 'utf8'));

function diagnosticFor(type, document, code) {
  let caught;
  try {
    validateSchema(type, document);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${type}: expected a schema failure`);
  const diagnostic = caught.archifyDiagnostics.find((entry) => entry.code === code);
  assert.ok(diagnostic, `${type}: missing ${code} in ${JSON.stringify(caught.archifyDiagnostics.map((entry) => entry.code))}`);
  return diagnostic;
}

test('schema/const repair names the allowed value for a numeric constant', () => {
  const document = example('web-app.architecture.json');
  document.schema_version = 2;
  const diagnostic = diagnosticFor('architecture', document, 'schema/const');
  assert.equal(diagnostic.evidence.allowedValue, 1);
  assert.deepEqual(diagnostic.supportedFixes, ['use 1 at /schema_version']);
});

test('schema/const repair quotes the allowed string value', () => {
  const document = example('web-app.architecture.json');
  document.diagram_type = 'workflow';
  const diagnostic = diagnosticFor('architecture', document, 'schema/const');
  assert.equal(diagnostic.evidence.allowedValue, 'architecture');
  assert.deepEqual(diagnostic.supportedFixes, ['use "architecture" at /diagram_type']);
});

test('schema/exclusiveMinimum repair names the exclusive bound and comparison', () => {
  const document = example('web-app.architecture.json');
  document.components[0].size[0] = 0;
  const diagnostic = diagnosticFor('architecture', document, 'schema/exclusiveMinimum');
  assert.equal(diagnostic.evidence.limit, 0);
  assert.deepEqual(diagnostic.supportedFixes, ['use a value > 0']);
});

test('schema/multipleOf repair names the required step', () => {
  const document = example('payments.class.json');
  document.types[0].col = 1.3;
  const diagnostic = diagnosticFor('class', document, 'schema/multipleOf');
  assert.equal(diagnostic.evidence.multipleOf, 0.5);
  assert.deepEqual(diagnostic.supportedFixes, ['use a multiple of 0.5']);
});

test('schema/exclusiveMaximum repair names the exclusive bound and comparison', async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile({ type: 'number', exclusiveMaximum: 10 });
  assert.equal(validate(10), false);
  const [error] = validate.errors;
  assert.equal(error.keyword, 'exclusiveMaximum');
  assert.deepEqual(await supportedFixesFor(error, { path: '/limit' }), ['use a value < 10']);
});

test('supportedFixes stays empty when the ajv param it needs is absent', async () => {
  assert.deepEqual(await supportedFixesFor({ keyword: 'exclusiveMaximum', params: {} }, { path: '/x' }), []);
  assert.deepEqual(await supportedFixesFor({ keyword: 'const', params: {} }, { path: '/x' }), []);
  assert.deepEqual(await supportedFixesFor({ keyword: 'multipleOf', params: {} }, { path: '/x' }), []);
});

test('zero-valued params still produce a repair hint', async () => {
  assert.deepEqual(await supportedFixesFor({ keyword: 'exclusiveMinimum', params: { comparison: '>', limit: 0 } }, { path: '/x' }), ['use a value > 0']);
  assert.deepEqual(await supportedFixesFor({ keyword: 'const', params: { allowedValue: 0 } }, { path: '/x' }), ['use 0 at /x']);
});
