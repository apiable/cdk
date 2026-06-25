output "sanctioned_bucket_arns" {
  description = "The single sanctioned destination allow-list every enforcement layer derives from"
  value       = local.sanctioned_bucket_arns
}

output "scp_id" {
  description = "Id of the authoritative Organizations SCP guardrail"
  value       = aws_organizations_policy.firehose_destination_guardrail.id
}

output "scp_content" {
  description = "Rendered SCP document (the operator-owned deny that holds above every channel)"
  value       = aws_organizations_policy.firehose_destination_guardrail.content
}
