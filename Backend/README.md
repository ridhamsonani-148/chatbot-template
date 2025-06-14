# Catholic Charities AI Assistant - Backend Infrastructure

This directory contains the complete AWS CDK infrastructure for the Catholic Charities AI Assistant.

## 🏗️ Architecture

\`\`\`
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   GitHub Repo   │    │   S3 Bucket      │    │  Q Business     │
│  (data_source)  │───▶│  (Data Sources)  │───▶│  Application    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
┌─────────────────┐    ┌──────────────────┐             │
│  Amplify App    │    │  API Gateway     │             │
│  (Frontend)     │◀───│  (REST API)      │             │
└─────────────────┘    └──────────────────┘             │
                                │                        │
                                ▼                        │
                       ┌──────────────────┐             │
                       │  Lambda Function │◀────────────┘
                       │  (Chat Handler)  │
                       └──────────────────┘
\`\`\`

## 📁 Directory Structure

\`\`\`
Backend/
├── cdk/                          # CDK Infrastructure Code
│   ├── lib/
│   │   └── catholic-charities-stack.ts  # Main CDK Stack
│   ├── bin/
│   │   └── catholic-charities-cdk.ts    # CDK App Entry Point
│   ├── package.json              # CDK Dependencies
│   ├── cdk.json                  # CDK Configuration
│   └── tsconfig.json             # TypeScript Configuration
├── lambda/
│   └── lambda_function.py        # Lambda Function Code
├── buildspec.yml                 # CodeBuild Configuration
├── deploy.sh                     # Deployment Script
├── test-deployment.sh            # Testing Script
└── README.md                     # This file
\`\`\`

## 🚀 Quick Start

### Prerequisites

1. **AWS CLI** configured with appropriate permissions
2. **Node.js** 18+ and npm
3. **GitHub repository** with:
   - `data_source/` folder containing your documents
   - `Backend/lambda/lambda_function.py` file
   - Frontend React application

### 1. One-Command Deployment

\`\`\`bash
cd Backend
chmod +x deploy.sh
./deploy.sh
\`\`\`

The script will prompt you for:
- GitHub repository URL
- GitHub token (for accessing your repository)
- GitHub branch (default: main)
- CodeBuild project name (default: CatholicCharitiesDeploy)

### 2. Manual CDK Deployment

If you prefer to deploy directly with CDK:

\`\`\`bash
cd Backend/cdk

# Install dependencies
npm install

# Bootstrap CDK (first time only)
npx cdk bootstrap

# Deploy with parameters
npx cdk deploy CatholicCharitiesStack \
  --parameters GitHubToken=your_github_token \
  --parameters GitHubOwner=your_github_username \
  --parameters GitHubRepo=your_repo_name \
  --parameters AmplifyGithubBranch=main
\`\`\`

## 🔧 What Gets Created

### 1. **S3 Bucket**
- Stores files from your `data_source/` folder
- Configured with proper permissions for Q Business

### 2. **Q Business Application**
- **Anonymous access enabled** (no user authentication required)
- **S3 Data Source**: Indexes files from your S3 bucket
- **Web Crawler**: Crawls Catholic Charities websites
- Automatic indexing and knowledge base creation

### 3. **Lambda Function**
- Deployed from `Backend/lambda/lambda_function.py`
- Environment variable: `QBUSINESS_APPLICATION_ID` (auto-populated)
- Handles chat requests and returns responses with sources

### 4. **API Gateway**
- REST API with CORS enabled
- `POST /chat` - Send messages to the chatbot
- `GET /health` - Health check endpoint

### 5. **Amplify App**
- Deploys your frontend React application
- Environment variables automatically configured:
  - `REACT_APP_API_BASE_URL`
  - `REACT_APP_CHAT_ENDPOINT`
  - `REACT_APP_HEALTH_ENDPOINT`

## 🧪 Testing Your Deployment

After deployment, test everything:

\`\`\`bash
./test-deployment.sh
\`\`\`

This will test:
- ✅ API Gateway health endpoint
- ✅ Chat functionality
- ✅ S3 data sources
- ✅ Q Business application status
- ✅ Amplify app accessibility

## 📋 Environment Variables

The CDK automatically configures all environment variables:

### Lambda Function
- `QBUSINESS_APPLICATION_ID` - Auto-populated from Q Business app creation

### Amplify App
- `REACT_APP_API_BASE_URL` - Auto-populated from API Gateway URL
- `REACT_APP_CHAT_ENDPOINT` - Auto-populated chat endpoint
- `REACT_APP_HEALTH_ENDPOINT` - Auto-populated health endpoint

## 🔍 Monitoring and Logs

### CloudWatch Logs
- Lambda function logs: `/aws/lambda/CatholicCharitiesStack-ChatLambda-*`
- API Gateway logs: Available in API Gateway console

### Q Business Console
- Monitor data source sync status
- View application metrics
- Check indexing progress

## 🛠️ Customization

### Adding More Data Sources

1. Add files to your `data_source/` folder in GitHub
2. Redeploy the stack - it will automatically upload new files

### Modifying Web Crawler URLs

Edit the `seedUrls` in `catholic-charities-stack.ts`:

\`\`\`typescript
'seedUrls': [
  'https://your-custom-url.com',
  'https://another-url.com'
]
\`\`\`

### Updating Lambda Function

1. Modify `Backend/lambda/lambda_function.py`
2. Redeploy the stack

## 🗑️ Cleanup

To destroy all resources:

\`\`\`bash
./deploy.sh
# When prompted, enter "destroy" as the action
\`\`\`

Or with CDK directly:

\`\`\`bash
cd Backend/cdk
npx cdk destroy CatholicCharitiesStack --force
\`\`\`

## 🔒 Security Features

- **Anonymous Q Business Access**: No user authentication required
- **CORS Enabled**: Allows frontend to communicate with API
- **IAM Roles**: Least privilege access for all services
- **S3 Security**: Private bucket with restricted access

## 💰 Cost Optimization

- Lambda: Pay per request
- Q Business: Pay per query
- S3: Pay for storage used
- API Gateway: Pay per API call
- Amplify: Free tier available

## 🆘 Troubleshooting

### Common Issues

1. **GitHub Access Denied**
   - Verify your GitHub token has repository access
   - Check if repository is public or token has private repo access

2. **Q Business Application Creation Failed**
   - Ensure you have Q Business permissions in your AWS account
   - Check if Q Business is available in your region

3. **Lambda Function Deployment Failed**
   - Ensure `Backend/lambda/lambda_function.py` exists in your repository
   - Check CloudFormation events for detailed error messages

4. **Amplify Build Failed**
   - Verify your frontend has a valid `package.json`
   - Check Amplify console for build logs

5. **API Gateway CORS Issues**
   - The CDK automatically configures CORS
   - If issues persist, check API Gateway console

### Getting Help

1. **Check CloudFormation Events**
   \`\`\`bash
   aws cloudformation describe-stack-events --stack-name CatholicCharitiesStack
   \`\`\`

2. **View Lambda Logs**
   \`\`\`bash
   aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/CatholicCharitiesStack"
   \`\`\`

3. **Q Business Application Status**
   \`\`\`bash
   aws qbusiness get-application --application-id YOUR_APP_ID
   \`\`\`

## 📞 Support

For issues with this deployment:

1. Check the troubleshooting section above
2. Review CloudFormation stack events
3. Check individual service consoles (Lambda, Q Business, API Gateway, Amplify)

## 🎯 Next Steps

After successful deployment:

1. **Test the chat functionality** with various questions
2. **Monitor Q Business indexing** progress in the console
3. **Add more documents** to your `data_source/` folder as needed
4. **Customize the frontend** to match your organization's branding
5. **Set up monitoring** and alerts for production use

## 📝 Notes

- The deployment takes 15-20 minutes due to Q Business application setup and indexing
- Data source synchronization happens automatically but may take additional time
- The system works immediately with web crawler data even if S3 files are still indexing
- All URLs and IDs are automatically configured - no manual environment variable setup required

---

**🎉 Congratulations!** You now have a fully automated Catholic Charities AI Assistant with no manual configuration required!
