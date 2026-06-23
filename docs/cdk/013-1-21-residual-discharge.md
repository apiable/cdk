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
`test/atdd-013-1-24-firehose-destination-scp-guardrail-iac.spec.ts` (scenarios S1, S3, S5).

## Promotion-gate status

With this guardrail in place the 013-1-21 accepted destination-bucket residual is **mitigated**: the
fail-OPEN can no longer be exploited at runtime. The production-promotion gate may certify the
stream tier (013-1-5 / 013-1-6) targeting a production central logging account **without re-accepting**
the 013-1-21 destination-bucket residual. The promotion-blocking obligation that otherwise sat on the
stream tier is **closed**.

**Required at production promotion:** deploy `terraform/apiable-logs-guardrail` (the Org SCP +
sanctioned bucket policies) to the Org/logging account before the stream tier serves a production
logging account. The control is operator-owned IaC, not part of the per-tenant channel.
