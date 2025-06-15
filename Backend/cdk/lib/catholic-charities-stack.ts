import * as cdk from "aws-cdk-lib"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as apigateway from "aws-cdk-lib/aws-apigateway"
import * as iam from "aws-cdk-lib/aws-iam"
import * as amplify from "@aws-cdk/aws-amplify-alpha"
import * as ssm from "aws-cdk-lib/aws-ssm"
import type { Construct } from "constructs"

export class CatholicCharitiesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // Parameters
    const githubToken = new cdk.CfnParameter(this, "GitHubToken", {
      type: "String",
      description: "GitHub token for accessing repository",
      noEcho: true,
    })

    const githubOwner = new cdk.CfnParameter(this, "GitHubOwner", {
      type: "String",
      description: "GitHub repository owner",
      default: "your-github-username",
    })

    const githubRepo = new cdk.CfnParameter(this, "GitHubRepo", {
      type: "String",
      description: "GitHub repository name",
      default: "catholic-charities-assistant",
    })

    const amplifyGithubBranch = new cdk.CfnParameter(this, "AmplifyGithubBranch", {
      type: "String",
      description: "GitHub branch for Amplify deployment",
      default: "main",
    })

    // 1. Create S3 bucket for data sources
    const dataBucket = new s3.Bucket(this, "CatholicCharitiesDataBucket", {
      bucketName: `catholic-charities-data-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    // 2. IAM Role for Q Business
    const qBusinessRole = new iam.Role(this, "QBusinessServiceRole", {
      assumedBy: new iam.ServicePrincipal("qbusiness.amazonaws.com"),
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
              resources: [dataBucket.bucketArn, `${dataBucket.bucketArn}/*`],
            }),
          ],
        }),
      },
    })

    // 3. Custom Resource Lambda for complete setup
    const setupLambda = new lambda.Function(this, "SetupLambda", {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: "index.handler",
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      code: lambda.Code.fromInline(`
import boto3
import json
import requests
import time
import cfnresponse
import zipfile
import io
import os

def handler(event, context):
    try:
        print(f"Event: {json.dumps(event, default=str)}")
        
        if event['RequestType'] == 'Create':
            # Get parameters
            github_token = event['ResourceProperties']['GitHubToken']
            github_owner = event['ResourceProperties']['GitHubOwner']
            github_repo = event['ResourceProperties']['GitHubRepo']
            bucket_name = event['ResourceProperties']['BucketName']
            service_role_arn = event['ResourceProperties']['ServiceRoleArn']
            
            s3_client = boto3.client('s3')
            qbusiness_client = boto3.client('qbusiness')
            
            print("Step 1: Downloading data_source files from GitHub...")
            
            # Download files from data_source folder
            headers = {'Authorization': f'token {github_token}'}
            
            def download_folder_contents(folder_path='data_source'):
                url = f'https://api.github.com/repos/{github_owner}/{github_repo}/contents/{folder_path}'
                response = requests.get(url, headers=headers)
                
                if response.status_code != 200:
                    print(f"Warning: Could not access {folder_path} folder: {response.text}")
                    return
                
                contents = response.json()
                file_count = 0
                
                for item in contents:
                    if item['type'] == 'file':
                        # Download file
                        file_response = requests.get(item['download_url'])
                        if file_response.status_code == 200:
                            # Upload to S3
                            s3_key = f"data-sources/{item['name']}"
                            s3_client.put_object(
                                Bucket=bucket_name,
                                Key=s3_key,
                                Body=file_response.content,
                                ContentType=get_content_type(item['name'])
                            )
                            print(f"Uploaded {item['name']} to S3")
                            file_count += 1
                    elif item['type'] == 'dir':
                        # Recursively download subdirectories
                        download_folder_contents(f"{folder_path}/{item['name']}")
                
                return file_count
            
            def get_content_type(filename):
                ext = filename.lower().split('.')[-1] if '.' in filename else ''
                content_types = {
                    'txt': 'text/plain',
                    'pdf': 'application/pdf',
                    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'html': 'text/html',
                    'json': 'application/json',
                    'csv': 'text/csv',
                    'md': 'text/markdown'
                }
                return content_types.get(ext, 'application/octet-stream')
            
            # Download data source files
            file_count = download_folder_contents()
            print(f"Downloaded {file_count} files from data_source folder")
            
            print("Step 2: Creating Q Business Application with anonymous access...")
            
            # Create Q Business Application with anonymous access
            app_response = qbusiness_client.create_application(
                displayName='Catholic Charities AI Assistant',
                description='AI Assistant for Catholic Charities services and information',
                identityType='AWS_IAM_IDP_SAML',  # This allows anonymous access
                attachmentsConfiguration={
                    'attachmentsControlMode': 'DISABLED'
                }
            )
            
            application_id = app_response['applicationId']
            print(f"Created Q Business Application: {application_id}")
            
            # Wait for application to be active
            max_attempts = 60
            for attempt in range(max_attempts):
                try:
                    app_status = qbusiness_client.get_application(applicationId=application_id)
                    if app_status['status'] == 'ACTIVE':
                        print("Application is active")
                        break
                    elif app_status['status'] == 'FAILED':
                        raise Exception("Application creation failed")
                except Exception as e:
                    if attempt == max_attempts - 1:
                        raise e
                    print(f"Waiting for application to be active... attempt {attempt + 1}")
                    time.sleep(10)
            
            print("Step 3: Creating S3 Data Source...")
            
            # Create S3 Data Source
            s3_data_source_response = qbusiness_client.create_data_source(
                applicationId=application_id,
                displayName='Catholic Charities S3 Data Source',
                type='S3',
                configuration={
                    'connectionConfiguration': {
                        'repositoryEndpointMetadata': {
                            'BucketName': bucket_name,
                            'BucketPrefix': 'data-sources/'
                        }
                    }
                },
                roleArn=service_role_arn
            )
            
            s3_data_source_id = s3_data_source_response['dataSourceId']
            print(f"Created S3 Data Source: {s3_data_source_id}")
            
            print("Step 4: Creating Web Crawler Data Source...")
            
            # Create Web Crawler Data Source
            web_crawler_response = qbusiness_client.create_data_source(
                applicationId=application_id,
                displayName='Catholic Charities Web Crawler',
                type='WEBCRAWLER',
                configuration={
                    'connectionConfiguration': {
                        'repositoryEndpointMetadata': {
                            'seedUrls': [
                                'https://www.catholiccharitiesusa.org/',
                                'https://www.catholiccharitiesusa.org/our-ministry/',
                                'https://www.catholiccharitiesusa.org/find-help/',
                                'https://www.catholiccharitiesusa.org/our-work/',
                                'https://www.catholiccharitiesusa.org/about-us/',
                                'https://www.catholiccharitiesusa.org/ways-to-give/'
                            ],
                            'maxLinksPerPage': 100,
                            'crawlDepth': 2
                        }
                    }
                },
                roleArn=service_role_arn
            )
            
            web_crawler_id = web_crawler_response['dataSourceId']
            print(f"Created Web Crawler: {web_crawler_id}")
            
            print("Step 5: Starting data source synchronization...")
            
            # Start data source sync jobs
            try:
                s3_sync_response = qbusiness_client.start_data_source_sync_job(
                    applicationId=application_id,
                    dataSourceId=s3_data_source_id
                )
                print(f"Started S3 data source sync: {s3_sync_response['executionId']}")
            except Exception as e:
                print(f"Failed to start S3 sync: {e}")
            
            try:
                web_sync_response = qbusiness_client.start_data_source_sync_job(
                    applicationId=application_id,
                    dataSourceId=web_crawler_id
                )
                print(f"Started web crawler sync: {web_sync_response['executionId']}")
            except Exception as e:
                print(f"Failed to start web crawler sync: {e}")
            
            print("Step 6: Setup complete!")
            
            # Return success with outputs
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {
                'ApplicationId': application_id,
                'S3DataSourceId': s3_data_source_id,
                'WebCrawlerId': web_crawler_id,
                'BucketName': bucket_name,
                'FileCount': str(file_count)
            }, application_id)
            
        elif event['RequestType'] == 'Delete':
            application_id = event['PhysicalResourceId']
            if application_id and application_id != 'FAILED':
                try:
                    qbusiness_client = boto3.client('qbusiness')
                    
                    # List and delete data sources first
                    try:
                        data_sources = qbusiness_client.list_data_sources(applicationId=application_id)
                        for ds in data_sources.get('dataSources', []):
                            try:
                                qbusiness_client.delete_data_source(
                                    applicationId=application_id,
                                    dataSourceId=ds['dataSourceId']
                                )
                                print(f"Deleted data source: {ds['dataSourceId']}")
                            except Exception as e:
                                print(f"Failed to delete data source {ds['dataSourceId']}: {e}")
                    except Exception as e:
                        print(f"Failed to list data sources: {e}")
                    
                    # Wait a bit for data sources to be deleted
                    time.sleep(30)
                    
                    # Delete the application
                    qbusiness_client.delete_application(applicationId=application_id)
                    print(f"Deleted Q Business Application: {application_id}")
                except Exception as e:
                    print(f"Failed to delete application: {e}")
            
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
            
        else:
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
            
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()
        cfnresponse.send(event, context, cfnresponse.FAILED, {})
      `),
      role: new iam.Role(this, "SetupLambdaRole", {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
        inlinePolicies: {
          QBusinessAccess: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["qbusiness:*"],
                resources: ["*"],
              }),
            ],
          }),
          S3Access: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["s3:*"],
                resources: [dataBucket.bucketArn, `${dataBucket.bucketArn}/*`],
              }),
            ],
          }),
          IAMAccess: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["iam:PassRole"],
                resources: [qBusinessRole.roleArn],
              }),
            ],
          }),
        },
      }),
    })

    // 4. Custom Resource to create Q Business Application and upload GitHub files
    const qBusinessSetup = new cdk.CustomResource(this, "QBusinessSetup", {
      serviceToken: setupLambda.functionArn,
      properties: {
        GitHubToken: githubToken.valueAsString,
        GitHubOwner: githubOwner.valueAsString,
        GitHubRepo: githubRepo.valueAsString,
        BucketName: dataBucket.bucketName,
        ServiceRoleArn: qBusinessRole.roleArn,
      },
    })

    const applicationId = qBusinessSetup.getAttString("ApplicationId")

    // 5. Create Lambda function for chat API (from Backend/lambda/lambda_function.py)
    const chatLambda = new lambda.Function(this, "ChatLambda", {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: "lambda_function.lambda_handler",
      code: lambda.Code.fromAsset("Backend/lambda"), // Points to your lambda code
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        QBUSINESS_APPLICATION_ID: applicationId,
      },
      role: new iam.Role(this, "ChatLambdaRole", {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
        inlinePolicies: {
          QBusinessAccess: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["qbusiness:ChatSync", "qbusiness:ListConversations", "qbusiness:GetConversation"],
                resources: [
                  `arn:aws:qbusiness:${this.region}:${this.account}:application/${applicationId}`,
                  `arn:aws:qbusiness:${this.region}:${this.account}:application/${applicationId}/*`,
                ],
              }),
            ],
          }),
        },
      }),
    })

    // 6. Create API Gateway
    const api = new apigateway.RestApi(this, "ChatApi", {
      restApiName: "Catholic Charities Chat API",
      description: "API for Catholic Charities AI Assistant",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "X-Amz-Date", "Authorization", "X-Api-Key", "X-Amz-Security-Token"],
      },
    })

    // Chat resource and methods
    const chatResource = api.root.addResource("chat")
    const chatIntegration = new apigateway.LambdaIntegration(chatLambda, {
      proxy: true,
    })

    // POST method for chat
    chatResource.addMethod("POST", chatIntegration)

    // Health check endpoint
    const healthResource = api.root.addResource("health")
    healthResource.addMethod("GET", chatIntegration)

    // Grant API Gateway permission to invoke Lambda
    chatLambda.addPermission("ApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      sourceArn: api.arnForExecuteApi(),
    })

    // 7. Store API URL in Parameter Store for Amplify
    const apiUrlParameter = new ssm.StringParameter(this, "ApiUrlParameter", {
      parameterName: "/catholic-charities/api-url",
      stringValue: api.url,
      description: "API Gateway URL for Catholic Charities Chat API",
    })

    const chatEndpointParameter = new ssm.StringParameter(this, "ChatEndpointParameter", {
      parameterName: "/catholic-charities/chat-endpoint",
      stringValue: `${api.url}chat`,
      description: "Chat API endpoint URL",
    })

    // 8. Create Amplify App (Simplified without GitHub integration for now)
    // We'll use Parameter Store to pass the API URL to the frontend
    const amplifyApp = new amplify.App(this, "CatholicCharitiesAmplifyApp", {
      appName: "catholic-charities-assistant",
      description: "Catholic Charities AI Assistant Frontend",
      environmentVariables: {
        REACT_APP_API_BASE_URL: api.url,
        REACT_APP_CHAT_ENDPOINT: `${api.url}chat`,
        REACT_APP_HEALTH_ENDPOINT: `${api.url}health`,
      },
    })

    // Add a branch (you can connect to GitHub later via console)
    const mainBranch = amplifyApp.addBranch("main", {
      stage: "PRODUCTION",
    })

    // 9. Outputs
    new cdk.CfnOutput(this, "DataBucketName", {
      value: dataBucket.bucketName,
      description: "S3 bucket for data sources",
      exportName: `${this.stackName}-DataBucketName`,
    })

    new cdk.CfnOutput(this, "QBusinessApplicationId", {
      value: applicationId,
      description: "Q Business Application ID",
      exportName: `${this.stackName}-QBusinessApplicationId`,
    })

    new cdk.CfnOutput(this, "ApiGatewayUrl", {
      value: api.url,
      description: "API Gateway URL",
      exportName: `${this.stackName}-ApiGatewayUrl`,
    })

    new cdk.CfnOutput(this, "ChatEndpoint", {
      value: `${api.url}chat`,
      description: "Chat API endpoint",
      exportName: `${this.stackName}-ChatEndpoint`,
    })

    new cdk.CfnOutput(this, "HealthEndpoint", {
      value: `${api.url}health`,
      description: "Health check endpoint",
      exportName: `${this.stackName}-HealthEndpoint`,
    })

    new cdk.CfnOutput(this, "AmplifyAppUrl", {
      value: `https://${amplifyGithubBranch.valueAsString}.${amplifyApp.defaultDomain}`,
      description: "Amplify App URL",
      exportName: `${this.stackName}-AmplifyAppUrl`,
    })

    new cdk.CfnOutput(this, "AmplifyAppId", {
      value: amplifyApp.appId,
      description: "Amplify App ID",
      exportName: `${this.stackName}-AmplifyAppId`,
    })
  }
}
