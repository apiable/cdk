#!/usr/bin/env bash

# Check if the required parameters are passed
if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
  echo "Usage: $0 <OPENAI_API_KEY> <ASSISTANT_ID> <FILE>"
  exit 1
fi

OPENAI_API_KEY=$1
ASSISTANT_ID=$2
FILE=$3

# Read the content from the file
if [ ! -f "$FILE" ]; then
  echo "File not found: $FILE"
  exit 1
fi

#Upload the file to get the file_id
#upload_response=$(curl -s https://api.openai.com/v1/files \
#  -H "Authorization: Bearer $OPENAI_API_KEY" \
#  -F purpose="assistants" \
#  -F file=@"$FILE")

#file_id=$(echo $upload_response | jq -r '.id')
file_id="file-oAuiebRFTOmw7a0RsW813jeG"
echo "File ID: $file_id"

# Check if file_id is extracted successfully
if [ -z "$file_id" ]; then
  echo "Failed to upload file and extract file_id"
  exit 1
fi

# First API call to create a thread
response=$(curl -s https://api.openai.com/v1/threads/runs \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "OpenAI-Beta: assistants=v2" \
  -d '{
      "assistant_id": "'"$ASSISTANT_ID"'",
      "thread": {
        "messages": [
          {
            "role": "user",
            "content": "Take the OpenAPI specification from the file under attachments and use it as a reference OpanAPI Specification. Only answer using knowledge from the files provided. Do not use general GPT knowledge. Use the following tokenUrl=https://staging.apiable.io/api/oauth2/token in the clientCredentials",
            "attachments": [
              {
                "file_id": "'"$file_id"'",
                "tools": [
                  {"type": "code_interpreter"}
                ]
              }
            ]
          }
        ]
      },
      "response_format": "auto"
    }')

# Extract thread_id from the response
thread_id=$(echo $response | jq -r '.thread_id')
run_id=$(echo $response | jq -r '.id')

# Check if thread_id is extracted successfully
if [ -z "$thread_id" ]; then
  echo "Failed to extract thread_id"
  exit 1
fi

echo "Thread ID: $thread_id"

slept_seconds=0
while true; do
  response=$(curl -s "https://api.openai.com/v1/threads/$thread_id/runs/$run_id" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "OpenAI-Beta: assistants=v2")

  status=$(echo $response | jq -r '.status')
  echo "Status: $status, Slept: $slept_seconds seconds"

  if [ "$status" == "completed" ] || [ "$slept_seconds" -ge 60 ]; then
    break
  fi
  sleep 5
  slept_seconds=$((slept_seconds + 5))
done

# Second API call to get the latest message
response=$(curl -s "https://api.openai.com/v1/threads/$thread_id/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "OpenAI-Beta: assistants=v2")

latest_message=$(echo $response | jq -r '.data[0].content[0].text.value')

# Extract JSON content between ``` or ```json and ```
json_content=$(echo "$latest_message" | sed -n '/^```/,$p' | sed -e '1d' -e '/^```/,$d' | jq '.')

# Save the latest message content to a file
echo "$json_content" > latest-corrected.json
# Save the latest message content to a file
echo "$latest_message" > latest-raw.json

#curl https://api.openai.com/v1/files/$file_id \
#  -X DELETE \
#  -H "Authorization: Bearer $OPENAI_API_KEY"

echo "Latest message content saved to latest-corrected.json"