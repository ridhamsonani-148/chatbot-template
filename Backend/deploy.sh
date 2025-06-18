#!/usr/bin/env bash
set -euo pipefail

# Prompt for GitHub URL (for public repos, no token needed)
if [ -z "${GITHUB_URL:-}" ]; then
  read -rp "Enter source GitHub repository URL (e.g., https://github.com/OWNER/REPO): " GITHUB_URL
fi

# Normalize URL
clean_url=${GITHUB_URL%.git}
clean_url=${clean_url%/}

# Extract owner/repo
if [[ $clean_url =~ ^https://github\.com/([^/]+/[^/]+)$ ]]; then
  path="${BASH_REMATCH[1]}"
elif [[ $clean_url =~ ^git@github\.com:([^/]+/[^/]+)$ ]]; then
  path="${BASH_REMATCH[1]}"
else
  echo "Unable to parse owner/repo from '$GITHUB_URL'"
  read -rp "Enter GitHub owner: " GITHUB_OWNER
  read -rp "Enter GitHub repo: " GITHUB_REPO
fi

if [ -z "${GITHUB_OWNER:-}" ] || [ -z "${GITHUB_REPO:-}" ]; then
  GITHUB_OWNER=${path%%/*}
  GITHUB_REPO=${path##*/}
  echo "Detected GitHub Owner: $GITHUB_OWNER"
  echo "Detected GitHub Repo: $GITHUB_REPO"
  read -rp "Is this correct? (y/n): " CONFIRM
  CONFIRM=$(printf '%s' "$CONFIRM" | tr '[:upper:]' '[:lower:]')
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "yes" ]]; then
    read -rp "Enter GitHub owner: " GITHUB_OWNER
    read -rp "Enter GitHub repo: " GITHUB_REPO
  fi
fi

# Prompt for project parameters
if [ -z "${PROJECT_NAME:-}" ]; then
  read -rp "Enter project name [default: catholic-charities-chatbot]: " PROJECT_NAME
  PROJECT_NAME=${PROJECT_NAME:-catholic-charities-chatbot}
fi

if [ -z "${AMPLIFY_APP_NAME:-}" ]; then
  read -rp "Enter Amplify app name [default: ${PROJECT_NAME}-frontend]: " AMPLIFY_APP_NAME
  AMPLIFY_APP_NAME=${AMPLIFY_APP_NAME:-${PROJECT_NAME}-frontend}
fi

if [ -z "${AMPLIFY_BRANCH_NAME:-}" ]; then
  read -rp "Enter Amplify branch name [default: main]: " AMPLIFY_BRANCH_NAME
  AMPLIFY_BRANCH_NAME=${AMPLIFY_BRANCH_NAME:-main}
fi

if [ -z "${URL_FILES_PATH:-}" ]; then
  read -rp "Enter path to URL files in Backend directory [default: data-sources]: " URL_FILES_PATH
  URL_FILES_PATH=${URL_FILES_PATH:-data-sources}
fi

if [ -z "${AWS_REGION:-}" ]; then
  read -rp "Enter AWS region [default: us-west-2]: " AWS_REGION
  AWS_REGION=${AWS_REGION:-us-west-2}
fi

if [ -z "${ACTION:-}" ]; then
  read -rp "Enter action [deploy/destroy]: " ACTION
  ACTION=$(printf '%s' "$ACTION" | tr '[:upper:]' '[:lower:]')
fi

if [[ "$ACTION" != "deploy" && "$ACTION" != "destroy" ]]; then
  echo "Invalid action: '$ACTION'. Choose 'deploy' or 'destroy'."
  exit 1
fi

# Validate that URL files exist
if [ -d "$URL_FILES_PATH" ]; then
  txt_files=$(find "$URL_FILES_PATH" -name "*.txt" 2>/dev/null | wc -l)
  if [ "$txt_files" -eq 0 ]; then
    echo "Warning: No .txt files found in '$URL_FILES_PATH'."
    echo "Please add .txt files with URLs (one URL per line)."
    read -rp "Continue anyway? (y/n): " CONTINUE
    CONTINUE=$(printf '%s' "$CONTINUE" | tr '[:upper:]' '[:lower:]')
    if [[ "$CONTINUE" != "y" && "$CONTINUE" != "yes" ]]; then
      exit 1
    fi
  else
    echo "Found $txt_files URL file(s) in '$URL_FILES_PATH':"
    find "$URL_FILES_PATH" -name "*.txt" -exec basename {} \;
  fi
else
  echo "Warning: URL files directory '$URL_FILES_PATH' not found locally."
fi

# Create IAM role
ROLE_NAME="${PROJECT_NAME}-codebuild-service-role"
echo "Checking for IAM role: $ROLE_NAME"

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "✓ IAM role exists"
  ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
else
  echo "✱ Creating IAM role: $ROLE_NAME"
  TRUST_DOC='{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"codebuild.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'

  ROLE_ARN=$(aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_DOC" \
    --query 'Role.Arn' --output text)

  echo "Attaching policies..."
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

  echo "Waiting for IAM role to propagate..."
  sleep 10
fi

# Create CodeBuild project
CODEBUILD_PROJECT_NAME="${PROJECT_NAME}-optimized-deploy"
echo "Creating CodeBuild project: $CODEBUILD_PROJECT_NAME"

# Build environment variables array (no GitHub token needed for public repos)
ENV_VARS=$(cat <<EOF
[
  {"name": "GITHUB_OWNER", "value": "$GITHUB_OWNER", "type": "PLAINTEXT"},
  {"name": "GITHUB_REPO", "value": "$GITHUB_REPO", "type": "PLAINTEXT"},
  {"name": "PROJECT_NAME", "value": "$PROJECT_NAME", "type": "PLAINTEXT"},
  {"name": "AMPLIFY_APP_NAME", "value": "$AMPLIFY_APP_NAME", "type": "PLAINTEXT"},
  {"name": "AMPLIFY_BRANCH_NAME", "value": "$AMPLIFY_BRANCH_NAME", "type": "PLAINTEXT"},
  {"name": "URL_FILES_PATH", "value": "$URL_FILES_PATH", "type": "PLAINTEXT"},
  {"name": "ACTION", "value": "$ACTION", "type": "PLAINTEXT"},
  {"name": "CDK_DEFAULT_REGION", "value": "$AWS_REGION", "type": "PLAINTEXT"}
]
EOF
)

ENVIRONMENT=$(cat <<EOF
{
  "type": "LINUX_CONTAINER",
  "image": "aws/codebuild/standard:7.0",
  "computeType": "BUILD_GENERAL1_MEDIUM",
  "environmentVariables": $ENV_VARS
}
EOF
)

ARTIFACTS='{"type":"NO_ARTIFACTS"}'
SOURCE=$(cat <<EOF
{
  "type":"GITHUB",
  "location":"$GITHUB_URL",
  "buildspec":"Backend/buildspec.yml"
}
EOF
)

# Delete existing project if it exists
if aws codebuild batch-get-projects --names "$CODEBUILD_PROJECT_NAME" --query 'projects[0].name' --output text 2>/dev/null | grep -q "$CODEBUILD_PROJECT_NAME"; then
  echo "Deleting existing CodeBuild project..."
  aws codebuild delete-project --name "$CODEBUILD_PROJECT_NAME"
  sleep 5
fi

aws codebuild create-project \
  --name "$CODEBUILD_PROJECT_NAME" \
  --source "$SOURCE" \
  --artifacts "$ARTIFACTS" \
  --environment "$ENVIRONMENT" \
  --service-role "$ROLE_ARN" \
  --output json \
  --no-cli-pager

if [ $? -eq 0 ]; then
  echo "✓ CodeBuild project '$CODEBUILD_PROJECT_NAME' created."
else
  echo "✗ Failed to create CodeBuild project."
  exit 1
fi

# Start build
echo "Starting optimized deployment..."
BUILD_ID=$(aws codebuild start-build \
  --project-name "$CODEBUILD_PROJECT_NAME" \
  --query 'build.id' \
  --output text)

if [ $? -eq 0 ]; then
  echo "✓ Build started with ID: $BUILD_ID"
  echo "You can monitor the build progress in the AWS Console:"
  echo "https://console.aws.amazon.com/codesuite/codebuild/projects/$CODEBUILD_PROJECT_NAME/build/$BUILD_ID"
else
  echo "✗ Failed to start build."
  exit 1
fi

echo ""
echo "=== Optimized Deployment Information ==="
echo "Project Name: $PROJECT_NAME"
echo "GitHub Repo: $GITHUB_OWNER/$GITHUB_REPO (Public - No Token Required)"
echo "Amplify App Name: $AMPLIFY_APP_NAME"
echo "Amplify Branch: $AMPLIFY_BRANCH_NAME"
echo "URL Files Path: $URL_FILES_PATH"
echo "AWS Region: $AWS_REGION"
echo "Action: $ACTION"
echo "Build ID: $BUILD_ID"
echo ""
echo "🚀 The optimized deployment will:"
echo "1. Deploy backend via CloudFormation (Only 2 Lambda functions)"
echo "2. Create Q Business data sources manually (no Lambda needed)"
echo "3. Create Amplify app '$AMPLIFY_APP_NAME' via CLI"
echo "4. Build and upload frontend to S3"
echo "5. Automatically deploy via EventBridge trigger"
echo ""
echo "⏱️ Total deployment time: ~10-15 minutes"
echo "📊 Monitor progress in CodeBuild console above"

exit 0
