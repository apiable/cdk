# 013-1-21 destination-bucket residual — discharge record

## Residual

013-1-21 (stream-capability parity gate) shipped with a human-accepted **fail-OPEN**: the release
parity gate cannot verify the usage-firehose's **destination S3 bucket**, because the destination is a
free **deploy-time parameter on both channels** (CFN `LogsBucketArn` / Terraform `var.logs_bucket_arn`).
There is no concrete value in either artifact for the gate to compare, so a hand-rolled Terraform
channel can point the stream at a divergent/unauthorized bucket and the gate still certifies the
channels equivalent. This is the `parity-gate-deploytime-param-ungateable-by-value` class.

The disposition (Allan, 2026-06-22, option 2) relocated the destination-bucket security control **out
of the build-time parity gate** to a **deploy-time guardrail**, owned by the central logging account /
Organization operator.

## Mitigation

The guardrail is the Terraform module `terraform/apiable-logs-guardrail`:

1. an authoritative **Organizations SCP** that denies the firehose delivery role any `s3:Put*` to a
   destination outside the sanctioned allow-list (`NotResource`), attached at the Org OU above every
   channel;
2. a defence-in-depth **bucket policy** on each sanctioned bucket admitting only sanctioned delivery
   roles, conditioned on `aws:SourceAccount` + `aws:PrincipalOrgID`;
3. a **single operator-owned source** for the sanctioned allow-list from which every layer derives.

A divergent destination is therefore **denied at runtime on every channel** — including a hand-rolled
one and with the parity gate bypassed — because enforcement is operator-side, above the distrusted
per-tenant channel. The denial is exercised by
`test/atdd-013-1-24-firehose-destination-scp-guardrail-iac.spec.ts` (scenarios S1, S3, S5), and the
SCP Deny is **non-forgeable** — keyed on a closed operator carve-out (`StringNotLike aws:PrincipalArn`),
NOT the firehose role's (channel-chosen) name, so a renamed in-Org hand-rolled delivery role is denied
**by default whatever it is named** (forcing test: a `…:role/usage-delivery` write to a non-sanctioned
bucket is still `Denied`).

## Scope of the discharge — what the guardrail reaches, and the owned residual

The authoritative layer is an **AWS Organizations SCP**, which binds only accounts that are **members
of the Apiable Organization**. The discharge is therefore exact about its reach:

- **In-Org production topology — DISCHARGED.** The production metering destination is the
  `apiable-logs-<name>` bucket, granted (per `terraform/apiable-logs-bucket/README.md`) to the **tenant
  account that runs `terraform apply`** and the central **`partner_account`** (default Apiable account
  `034444869755`) — precisely the "Org OU spanning the tenant + logging accounts" topology the SCP
  attaches above. Every channel that targets this topology — **including a hand-rolled but in-Org one** —
  is reached by the SCP and denied a divergent destination. This is the set the production-promotion
  gate governs, and it is the closeable gap the rebuild closed (the Deny is now keyed on a non-forgeable
  operator invariant, not the forgeable role name).
- **Genuinely out-of-Org third-party hand-rolled channel — OWNED deploy-time residual.** A channel
  hand-rolled by a third party in an AWS account that is **not** an Apiable Org member is
  **structurally unreachable by ANY Org SCP** — no Org policy binds a non-member account. This is the
  irreducible `parity-gate-deploytime-param-ungateable-by-value` class already **accepted** at 013-1-21
  and 013-1-23: it is **out of scope for the SCP layer** and **owned as a deploy-time residual**, not a
  closeable code gap. It is defended-in-depth by the sanctioned bucket policy's
  `aws:PrincipalOrgID` / `aws:SourceAccount` conditions (which deny a cross-Org delivery role that
  guesses a sanctioned ARN) and by 013-1-21's build-time detection, and it is **not** in the governed
  spec's fixture set — every fixture is in-Org (`CENTRAL_ACCOUNT=111111111111`, `ORG_ID=o-exampleorgid`),
  so the frozen contract stays satisfiable and is **not** re-scoped.

## F3 bucket-layer reconciliation — resolved doc-only

The bucket layer of the guardrail (the defence-in-depth `aws_s3_bucket_policy.sanctioned` in
`terraform/apiable-logs-guardrail`) and the per-tenant destination bucket's own policy
(`terraform/apiable-logs-bucket`) are reconciled by design as a recorded engineering decision, not by
folding one into the other:

- **The SCP is the authoritative deny-elsewhere control.** A divergent destination is denied because the
  Org SCP denies the firehose write actions to any resource outside the sanctioned allow-list, above the
  channel. The bucket policies are defence-in-depth, never the authoritative layer.
- **The guardrail module's standalone sanctioned bucket policy is the bucket-layer allow-floor for the
  sanctioned set.** Each sanctioned bucket carries an `aws_s3_bucket_policy.sanctioned` admitting only
  sanctioned delivery roles, conditioned on `aws:SourceAccount` + `aws:PrincipalOrgID`. This policy is
  kept and is pinned by the governed spec (every allow-list bucket must be governed by a bucket policy in
  the guardrail fixture).
- **The per-tenant `apiable-logs-<name>` real destination is governed in-Org by its own policy plus the
  SCP.** That bucket already carries an `account:root` (+ `partner_account:root`) policy from the
  `terraform/apiable-logs-bucket` module (013-1-4); the in-tenant firehose runs in the deploying account,
  so its writes are already permitted by that `account:root` grant, and writes elsewhere are denied by the
  SCP. Nothing in the guardrail is mis-pointed at the per-tenant bucket, so the concern that the
  defence-in-depth policy "never governs the real destination" or "clobbers the partner-read grant" does
  not arise — no guardrail policy targets that bucket.
- **No fold is performed.** Folding the conditioned `s3:PutObject` allow into the `apiable-logs-bucket`
  policy is functionally **inert** — the existing `account:root` `s3:*` grant already permits the
  in-tenant firehose's writes, and the authoritative deny-elsewhere is the SCP — and it would break two
  frozen, human-approved governed specs: 013-1-24 S4 (requires the guardrail to declare a bucket policy
  per sanctioned bucket) and 013-1-4 S2 (pins the logs-bucket action set to exactly `s3:*` +
  `sts:AssumeRole`). Both frozen contracts stay intact and are **not** re-scoped.

## Promotion-gate status

With this guardrail in place the 013-1-21 accepted destination-bucket residual is **mitigated** for the
**in-Org production topology** the gate governs: the fail-OPEN can no longer be exploited at runtime by
any channel — including a hand-rolled but in-Org one — that targets the `apiable-logs-<name>` topology.
The production-promotion gate may certify the stream tier (013-1-5 / 013-1-6) targeting a production
central logging account **without re-accepting** the 013-1-21 destination-bucket residual for that
topology. The promotion-blocking obligation that otherwise sat on the stream tier is **closed**.

**Owned residual carried on this gate (not a re-opened block):** a genuinely out-of-Org third-party
hand-rolled channel (see "Scope of the discharge" above) remains an **owned deploy-time residual** of
the `parity-gate-deploytime-param-ungateable-by-value` class — the same disposition as 013-1-21 and
013-1-23 — structurally unreachable by the Org SCP and defended-in-depth only. It does not block
promotion for the Org-governed production set, and it requires no further code: it is owned, not open.

**Required at production promotion:** deploy `terraform/apiable-logs-guardrail` (the Org SCP +
sanctioned bucket policies) to the Org/logging account before the stream tier serves a production
logging account. The control is operator-owned IaC, not part of the per-tenant channel.
