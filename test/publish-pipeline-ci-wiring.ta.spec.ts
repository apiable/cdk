import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

/**
 * S3 (013-1-29): the publish pipeline's producer-side proofs — including the overwrite guard's
 * changed-content refusal — must run in the PR-triggered job, not only post-merge, so a change that
 * weakens the guard cannot merge unnoticed. Asserted here rather than inside test-verify-launchstack-
 * published.sh itself, because a check that only runs when its own CI wiring already exists can never
 * catch that wiring being removed. This spec runs as part of the same `npm test` step that already
 * executes unconditionally in the PR job, independent of the wiring it asserts on.
 */

interface WorkflowStep {
  readonly name?: string
  readonly run?: string
}

interface WorkflowJob {
  readonly steps?: readonly WorkflowStep[]
}

interface Workflow {
  readonly jobs: Record<string, WorkflowJob>
}

const BUILD_WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'build.yml')

describe('013-1-29 S3 — publish-pipeline tests run pre-merge, in the PR job @API @ATDD', () => {
  it('the PR-triggered `test` job includes a step running test:publish-pipeline', () => {
    const workflow = yaml.load(fs.readFileSync(BUILD_WORKFLOW, 'utf8')) as Workflow
    const steps = workflow.jobs.test?.steps ?? []
    const runsPublishPipelineTests = steps.some((step) => step.run?.includes('test:publish-pipeline'))

    expect(runsPublishPipelineTests).toBe(true)
  })
})
