#!/usr/bin/env bash
set -euo pipefail

# Prompt for GitHub URL
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

# Prompt for GitHub token
if [ -z "${GITHUB_TOKEN:-}" ]; then
  read -rp "Enter GitHub token: " GITHUB_TOKEN
fi

# Prompt for other parameters
if [ -z "${PROJECT_NAME:-}" ]; then
  read -rp "Enter project name [default: catholic-charities-chatbot]: " PROJECT_NAME
  PROJECT_NAME=${PROJECT_NAME:-catholic-charities-chatbot}
fi

# Prompt for URL files path (relative to Backend directory)
if [ -z "${URL_FILES_PATH:-}" ]; then
  read -rp "Enter path to URL files in Backend directory [default: data-sources]: " URL_FILES_PATH
  URL_FILES_PATH=${URL_FILES_PATH:-data-sources}
fi

# Prompt for AWS region (default to us-west-2 for Q Business availability)
if [ -z "${AWS_REGION:-}" ]; then
  read -rp "Enter AWS region [default: us-west-2]: " AWS_REGION
  AWS_REGION=${AWS_REGION:-us-west-2}
fi

# Prompt for Identity Center ARN (required)
if [ -z "${IDENTITY_CENTER_INSTANCE_ARN:-}" ]; then
  echo ""
  echo "🔍 Identity Center Configuration:"
  echo "Since your account uses the organization's Identity Center, provide the organization's Identity Center ARN."
  echo "Example: arn:aws:sso:::instance/ssoins-abcdefgh12345678"
  echo ""
  read -rp "Enter Identity Center Instance ARN: " IDENTITY_CENTER_INSTANCE_ARN
  if [ -z "$IDENTITY_CENTER_INSTANCE_ARN" ]; then
    echo "Error: Identity Center Instance ARN is required."
    exit 1
  fi
fi

# Validate that URL files exist (check locally if running from Backend directory)
if [ -d "$URL_FILES_PATH" ]; then
  # Check for .txt files
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
  echo "This is normal if running from a different location. The build will check during deployment."
fi

if [ -z "${ACTION:-}" ]; then
  read -rp "Enter action [deploy/destroy]: " ACTION
  ACTION=$(printf '%s' "$ACTION" | tr '[:upper:]' '[:lower:]')
fi

if [[ "$ACTION" != "deploy" && "$ACTION" != "destroy" ]]; then
  echo "Invalid action: '$ACTION'. Choose 'deploy' or 'destroy'."
  exit 1
fi

# Validate GitHub token and repository
echo "Validating GitHub token and repository..."
repo_check=$(curl -s -H "Authorization: token $GITHUB_TOKEN" "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO")
if echo "$repo_check" | grep -q "Not Found"; then
  echo "Error: Repository $GITHUB_OWNER/$GITHUB_REPO not found or token invalid."
  exit 1
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
CODEBUILD_PROJECT_NAME="${PROJECT_NAME}-deploy"
echo "Creating CodeBuild project: $CODEBUILD_PROJECT_NAME"

# Build environment variables array
ENV_VARS=$(cat <<EOF
[
  {"name": "GITHUB_OWNER", "value": "$GITHUB_OWNER", "type": "PLAINTEXT"},
  {"name": "GITHUB_REPO", "value": "$GITHUB_REPO", "type": "PLAINTEXT"},
  {"name": "GITHUB_TOKEN", "value": "$GITHUB_TOKEN", "type": "PLAINTEXT"},
  {"name": "PROJECT_NAME", "value": "$PROJECT_NAME", "type": "PLAINTEXT"},
  {"name": "URL_FILES_PATH", "value": "$URL_FILES_PATH", "type": "PLAINTEXT"},
  {"name": "ACTION", "value": "$ACTION", "type": "PLAINTEXT"},
  {"name": "CDK_DEFAULT_REGION", "value": "$AWS_REGION", "type": "PLAINTEXT"},
  {"name": "IDENTITY_CENTER_INSTANCE_ARN", "value": "$IDENTITY_CENTER_INSTANCE_ARN", "type": "PLAINTEXT"}
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
echo "Starting build for '$CODEBUILD_PROJECT_NAME'..."
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
echo "=== Deployment Information ==="
echo "Project Name: $PROJECT_NAME"
echo "GitHub Repo: $GITHUB_OWNER/$GITHUB_REPO"
echo "URL Files Path: $URL_FILES_PATH (in Backend directory)"
echo "AWS Region: $AWS_REGION"
echo "Identity Center ARN: $IDENTITY_CENTER_INSTANCE_ARN"
if [ -d "$URL_FILES_PATH" ]; then
  echo "URL Files Found: $(find "$URL_FILES_PATH" -name "*.txt" 2>/dev/null | wc -l)"
fi
echo "Action: $ACTION"
echo "Build ID: $BUILD_ID"
echo ""
echo "The deployment will create:"
echo "- Q Business Application with S3 data source"
echo "- Lambda function for chat API"
echo "- API Gateway for REST endpoints"
echo "- Amplify app for frontend hosting"
echo "- S3 bucket for data sources"

exit 0