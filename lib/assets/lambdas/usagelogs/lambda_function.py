"""
  Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
  Permission is hereby granted, free of charge, to any person obtaining a copy of this
  software and associated documentation files (the "Software"), to deal in the Software
  without restriction, including without limitation the rights to use, copy, modify,
  merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so.
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
  INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
  PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
  HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
  OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
"""

import boto3
import base64
import json
import ast

apigw = boto3.client('apigateway')
# apiKey:apiStage:apiKeyId -> Usage Plan Name
usage_plan_mapping = {}
# apiKeyId -> customer name
customer_mapping = {}

# Get all the APIGW Usage Plans for this account
# TODO: Paginate results for >300 plans
# https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/apigateway/client/get_usage_plans.html
account_usage_plans = apigw.get_usage_plans(limit=300)

# For each APIGW Usage Plan, get the APIs and API Stages it's applied to 
# and the keys of the customers in that plan
for plan in account_usage_plans['items']:
    plan_id = plan['id']
    plan_name = plan['name']
    plan_api_stages = plan['apiStages']
    # Get all the API Keys (customers) assigned to this plan
    plan_keys = apigw.get_usage_plan_keys(usagePlanId=plan_id)
    
    # For each API Key, store the mapping to the customer name.
    # Also store the mapping from api-apiStage-apiKey to usage plan name
    # TODO: Paginate results for > 25 customers in a plan
    for plan_key in plan_keys['items']:
        key_id = plan_key['id']
        key_name = plan_key['name']
        customer_mapping[key_id] = key_name
        
        for api_stage in plan_api_stages:
            usage_plan_lookup = api_stage['apiId'] + ':' + api_stage['stage'] + ":" + key_id
            usage_plan_mapping[usage_plan_lookup] = plan_name
            
def lambda_handler(event, context):
    output = []

    for record in event['records']:
        print(record['recordId'])
        # Decode from base64 to binary
        binary_payload = base64.b64decode(record['data'])
        
        # Decode binary to string and convert to dictionary
        payload_dict = ast.literal_eval(binary_payload.decode("UTF-8"))
        # Add customer name to payload via API Key Id lookup
        payload_dict['subscription_id'] = customer_mapping.get(payload_dict['key_id'], '-') 
        usage_plan_lookup = payload_dict['api_id'] + ':' + payload_dict['stage'] + ":" + payload_dict['key_id']
        payload_dict['plan_id'] = usage_plan_mapping.get(usage_plan_lookup, '-')
				
        
        
        # Encode back to binary, adding a newline to the end of the string
        print("Updated dict payload is " + str(payload_dict))
        new_payload_string = json.dumps(payload_dict) + '\n'
        new_payload_binary = new_payload_string.encode('utf-8') 
        
        #print(new_payload_binary)
        output_record = {
            'recordId': record['recordId'],
            'result': 'Ok',
            'data': base64.b64encode(new_payload_binary)
        }
        output.append(output_record)

    print('Successfully processed {} records.'.format(len(event['records'])))

    return {'records': output}