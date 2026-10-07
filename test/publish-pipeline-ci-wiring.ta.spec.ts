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
  readonly needs?: string | readonly string[]
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

/**
 * Three pieces of wiring stand between a Terraform module and the store: the job that publishes waits
 * for the `test` job, it runs the engine checks on the gateway-role module, and it does so before the
 * synth builds the archive that the upload then sends. A workflow with any one of them taken out runs
 * every other spec green, so each is held here, in the `npm test` step a pull request runs.
 */
describe('the job that publishes is held to what has to pass before the upload', () => {
  const ENGINE_CHECKS = 'bash check-gateway-role-module.sh terraform/apiable-gateway-role'
  const SYNTH = 'synth-all-launchstack.sh'
  const UPLOAD = 'publish-launchstack.sh'

  /** The one job that runs the upload. Any other count throws, so no test here passes on no job, or on one job of two. */
  const publishingJob = (): WorkflowJob => {
    const workflow = yaml.load(fs.readFileSync(BUILD_WORKFLOW, 'utf8')) as Workflow
    const jobs = Object.values(workflow.jobs).filter((job) => job.steps?.some((step) => step.run?.includes(UPLOAD)))
    if (jobs.length !== 1) throw new Error(`expected exactly one job to run ${UPLOAD}, found ${jobs.length}`)
    return jobs[0]
  }

  it('the job that publishes needs the test job', () => {
    const { needs } = publishingJob()

    expect(typeof needs === 'string' ? [needs] : needs ?? []).toContain('test')
  })

  it('the job that publishes runs the engine checks on the gateway-role module, then the synth, then the upload', () => {
    const steps = publishingJob().steps ?? []
    const engineChecks = steps.findIndex((step) => step.run?.trim() === ENGINE_CHECKS)
    const synth = steps.findIndex((step) => step.run?.includes(SYNTH))
    const upload = steps.findIndex((step) => step.run?.includes(UPLOAD))

    expect(engineChecks).not.toBe(-1)
    expect(synth).toBeGreaterThan(engineChecks)
    expect(upload).toBeGreaterThan(synth)
  })
})
