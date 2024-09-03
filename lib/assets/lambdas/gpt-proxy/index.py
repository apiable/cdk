import json
import requests
import os
import logging
import re
import time

# Configure the logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Global map to store conversation history
conversation_history = {}

def add_cors_headers(response):
    """Helper function to add CORS headers to the response without overriding existing headers."""
    if 'headers' not in response:
        response['headers'] = {}

    response['headers'].update({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': '*'
    })

    return response

def handler(event, context):

    # Log the entire event as a JSON string
    logger.info("Received event: %s", json.dumps(event))
    logger.info("Received body: %s", event['body'])
    logger.info("Received context: %s", context)

    # Extract the HTTP method from the event context
    http_method = event['context']['http-method']
    path = f"/{event['params']['path']['proxy']}"

    # Allowed methods
    allowed_methods = ['POST', 'OPTIONS']

    # Allowed paths
    allowed_paths = [
        "/chat/completions",
        "/gpt",
        "/threads",
        "/threads/runs",
        "/assistants",
        "/assistant",
        re.compile(r"^/assistants/[^/]+$"),
        re.compile(r"^/threads/[^/]+$"),
        re.compile(r"^/threads/[^/]+/runs$")
    ]

    extracted_value = None
    mode = "gpt"
    if path == "/gpt":
        path = "/chat/completions"
    elif path == "/assistants" or path == "/assistant":
        path = "/threads/runs"
        mode = "assistant-default"
    elif re.match(r"^/assistants/[^/]+$", path):
        mode = "assistant-custom"
        # Extract the value after /assistants/
        match = re.match(r"^/assistants/([^/]+)$", path)
        if match:
            extracted_value = match.group(1)
            logger.info("Extracted assistant ID: %s", extracted_value)
        path = "/threads/runs"

    assistant_id = extracted_value or os.environ['ASSISTANT_ID']
    logger.info("Assistant ID: %s", assistant_id)

    logger.info("Path: %s", path)

    # Check if the method is allowed
    if http_method not in allowed_methods:
        # Return a 400 Bad Request with "method not allowed" message
        return {
            'statusCode': 400,
            'body': json.dumps({'message': 'Method not allowed'}),
            'headers': {
                'Content-Type': 'application/json'
            }
        }

    # Check if the path is allowed
    if not any(isinstance(p, str) and p == path or isinstance(p, re.Pattern) and p.match(path) for p in allowed_paths):
        return {
            'statusCode': 404,
            'headers': {
                'Content-Type': 'application/json'
            }
        }

    # Extract data from the incoming API Gateway POST body
    try:
        body = event['body'] #json.loads(event['body'])
        prompt = body.get('prompt', '')
        context_id = body.get('context_id', '')
    except (json.JSONDecodeError, KeyError) as e:
        logger.error("Error parsing input: %s", str(e))
        return add_cors_headers({
            'statusCode': 400,
            'body': json.dumps({'error': 'Invalid input. Please provide a valid prompt.'})
        })

    headers = {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"}

    messages = [{"role": "user", "content": prompt}]
    # Retrieve previous conversation history
    if context_id:
        context_id = f"{mode}-{context_id}"
        if context_id not in conversation_history:
            conversation_history[context_id] = []
        # Append new user input to conversation history
        conversation_history[context_id].append({"role": "user", "content": prompt})
        messages = conversation_history[context_id]


    logger.info("Conversation history: %s", json.dumps(messages))

    # Determine the API URL based on the path
    if path == "/chat/completions":
        api_url = "https://api.openai.com/v1/chat/completions"
        jsonBody = {
            "model": "gpt-4",
            "messages": messages
        }
    elif path == "/threads":
        api_url = "https://api.openai.com/v1/threads"
        jsonBody = ""
    elif path == "/threads/runs":
        api_url = "https://api.openai.com/v1/threads/runs"
        headers["Content-Type"] = "application/json"
        headers["OpenAI-Beta"] = "assistants=v2"
        jsonBody = {
            "assistant_id": assistant_id,
            "thread": {
                "messages": messages
            }
        }
    elif re.match(r"^/threads/[^/]+/runs$", path):
        api_url = f"https://api.openai.com/v1{path}"
        headers["Content-Type"] = "application/json"
        headers["OpenAI-Beta"] = "assistants=v2"
        jsonBody = {
            "assistant_id": os.environ['ASSISTANT_ID']
        }
    logger.info("Api Url: %s", api_url)

    if api_url is None:
        return add_cors_headers({
            'statusCode': 400,
            'body': json.dumps({'error': 'no api url matched.'})
        })

    # Example request to ChatGPT API (you should replace with actual API request)
    try:
        chatgpt_response = requests.post(api_url,
                                         headers=headers,
                                         json=jsonBody
                                         )

        chatgpt_response_json = chatgpt_response.json()
        logger.info("ChatGPT response: %s", json.dumps(chatgpt_response_json))

        # Extract the run_id from the response
        if path == "/threads/runs" or re.match(r"^/threads/[^/]+/runs$", path):
            run_id = chatgpt_response_json.get('id')
            thread_id = chatgpt_response_json.get('thread_id')
            # Poll the /threads/{thread_id}/runs/{run_id} API until the status is "completed"
            logger.info("thread_id: %s, run_id: %s", thread_id, run_id)
            status = ""
            count = 0
            follow_up_url = f"https://api.openai.com/v1/threads/{thread_id}/runs/{run_id}"
            logger.info("follow_up_url: %s", follow_up_url)
            while status != "completed" and count < 5:
                follow_up_response = requests.get(follow_up_url, headers=headers)
                chatgpt_response_json = follow_up_response.json()
                logger.info("Polling response: %s", json.dumps(chatgpt_response_json))
                status = chatgpt_response_json.get('status', '')
                time.sleep(5)  # Wait for 2 seconds before polling again
                count += 1
            logger.info("Final response: %s", json.dumps(chatgpt_response_json))

        # this happens when the response takes too long
        if chatgpt_response_json.get('usage', {}).get('prompt_tokens', 0) is None:
            return add_cors_headers({
                'statusCode': 400,
                'body': json.dumps({'error': 'No usage details found in the response.'})
            })

        # Extract usage data from the ChatGPT response
        usage = chatgpt_response_json.get('usage', {})
        prompt_tokens = usage.get('prompt_tokens', 0)
        completion_tokens = usage.get('completion_tokens', 0)
        total_tokens = usage.get('total_tokens', 0)

        # Log the usage details
        logger.info(f"Usage details - Prompt Tokens: {prompt_tokens}, Completion Tokens: {completion_tokens}, Total Tokens: {total_tokens}")

        if path == "/threads/runs" or re.match(r"^/threads/[^/]+/runs$", path):
            follow_up_url=f"https://api.openai.com/v1/threads/{thread_id}/messages"
            follow_up_response = requests.get(follow_up_url, headers=headers)
            chatgpt_response_json = follow_up_response.json()
            output_text = chatgpt_response_json.get('data', [{"content":[{"text":{"value":"Sorry, I couldn't process your request."}}]}])[0]['content'][0]['text']['value']
            #body = json.dumps({'answer': output_text, 'thread_id': thread_id, 'run_id': run_id})
            body = json.dumps({'answer': output_text})
        else:
            output_text = chatgpt_response_json.get('choices', [{"messsage":{"content":"Sorry, I couldn't process your request."}}])[0]['message']['content']
            body = json.dumps({'answer': output_text})

        # Append new system input to conversation history
        if context_id:
            conversation_history[context_id].append({"role": "assistant", "content": output_text})

        # Prepare the final response with headers including the usage information
        response = {
            'statusCode': 200,
            'headers': {
                'usageprompttokens': str(prompt_tokens),
                'usagecompletiontokens': str(completion_tokens),
                'usagetotaltokens': str(total_tokens)
            },
            'body': body
        }

        return add_cors_headers(response)

    except requests.RequestException as e:
        logger.error("Error communicating with ChatGPT: %s", str(e))
        return add_cors_headers({
            'statusCode': 500,
            'body': json.dumps({'error': 'Failed to communicate with ChatGPT.'})
        })
