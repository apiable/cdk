/**
 * The credentialed regen check compares a fresh plan, made in the CI account, with the committed fixture,
 * written with the 111111111111 placeholder. Each side must tokenise its own deploying account, or the
 * fixture's tenant root reads as an external bucket writer and an unchanged module reports as stale.
 */
import * as fs from 'fs'
import { compareRegen } from '../scripts/parity-tf-regen-check'
import { USAGE_EVENTS } from './support/parity-channels'

const CI_ACCOUNT = '222233334444'
/** The placeholder deploying account the fixture is written with, as the CI step passes it. */
const FIXTURE_ACCOUNT = '111111111111'
const committed = (): unknown => JSON.parse(fs.readFileSync(USAGE_EVENTS.tfFixture, 'utf8'))
/** The same plan as made in another account: only the deploying account's id differs. */
const freshFrom = (account: string): unknown =>
  JSON.parse(fs.readFileSync(USAGE_EVENTS.tfFixture, 'utf8').split(FIXTURE_ACCOUNT).join(account))

describe('parity-tf-regen-check — the deploying account on each side', () => {
  it('the channel row and the CI step agree on the placeholder account', () => {
    expect(USAGE_EVENTS.tfDeployAccount).toBe(FIXTURE_ACCOUNT)
  })

  // contract: 024-3-6 S9
  it('an unchanged module planned in the CI account matches the fixture written with the placeholder account', () => {
    const result = compareRegen(freshFrom(CI_ACCOUNT), committed(), USAGE_EVENTS.tfRegion, CI_ACCOUNT, FIXTURE_ACCOUNT)

    expect(result.wellFormed).toBe(true)
    expect(result.same).toBe(true)
  })

  it('with one account for both sides, the placeholder stays an external writer and the fixture reads as stale', () => {
    expect(compareRegen(freshFrom(CI_ACCOUNT), committed(), USAGE_EVENTS.tfRegion, CI_ACCOUNT).same).toBe(false)
  })

  it('a real change still reads as stale under separate accounts: a partner account the fixture does not grant', () => {
    const fresh = JSON.parse(JSON.stringify(freshFrom(CI_ACCOUNT)).split('034444869755').join('999988887777'))

    expect(compareRegen(fresh, committed(), USAGE_EVENTS.tfRegion, CI_ACCOUNT, FIXTURE_ACCOUNT).same).toBe(false)
  })
})
