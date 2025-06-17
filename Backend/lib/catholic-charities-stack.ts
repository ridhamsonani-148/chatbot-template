import * as cdk from "aws-cdk-lib"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as apigateway from "aws-cdk-lib/aws-apigateway"
import * as iam from "aws-cdk-lib/aws-iam"
import * as amplify from "aws-cdk-lib/aws-amplify"
import * as qbusiness from "aws-cdk-lib/aws-qbusiness"
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment"
import type { Construct } from "constructs"

export interface CatholicCharitiesStackProps extends cdk.StackProps {
  readonly githubOwner: string
  readonly githubRepo: string
  readonly githubToken: string
  readonly projectName?: string
  readonly urlFilesPath?: string // Path to URL files in the repo
  readonly identityCenterInstanceArn?: string // Optional: Organization's Identity Center ARN
}

export class CatholicCharitiesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CatholicCharitiesStackProps) {
    super(scope, id, props)

    const projectName = props.projectName || "catholic-charities-chatbot"
    const urlFilesPath = props.urlFilesPath || "data-sources" // Default path for URL files

    // Handle Identity Center ARN - use provided ARN or create a custom resource to find it
    let identityCenterInstanceArn: string

    if (props.identityCenterInstanceArn) {
      // Use provided organization Identity Center ARN
      identityCenterInstanceArn = props.identityCenterInstanceArn
      console.log(`Using provided Identity Center ARN: ${identityCenterInstanceArn}`)
    } else {
      // Create a custom resource to dynamically find Identity Center ARN
      const identityCenterFinder = new lambda.Function(this, "IdentityCenterFinder", {
        runtime: lambda.Runtime.PYTHON_3_11,
        handler: "index.handler",
        code: lambda.Code.fromInline(`
import boto3
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    try:
        request_type = event['RequestType']
        
        if request_type == 'Create' or request_type == 'Update':
            # Try to find Identity Center instance
            sso_client = boto3.client('sso-admin')
            
            try:
                response = sso_client.list_instances()
                instances = response.get('Instances', [])
                
                if not instances:
                    return {
                        'Status': 'FAILED',
                        'PhysicalResourceId': 'identity-center-finder',
                        'Reason': 'No IAM Identity Center instance found. Please enable Identity Center or provide the organization Identity Center ARN.'
                    }
                
                instance_arn = instances[0]['InstanceArn']
                
                if len(instances) > 1:
                    logger.warning(f"Multiple Identity Center instances found. Using: {instance_arn}")
                
                return {
                    'Status': 'SUCCESS',
                    'PhysicalResourceId': 'identity-center-finder',
                    'Data': {
                        'InstanceArn': instance_arn
                    }
                }
                
            except Exception as e:
                logger.error(f"Error finding Identity Center: {str(e)}")
                return {
                    'Status': 'FAILED',
                    'PhysicalResourceId': 'identity-center-finder',
                    'Reason': f'Failed to find Identity Center: {str(e)}. Please provide the organization Identity Center ARN as a parameter.'
                }
        
        elif request_type == 'Delete':
            return {
                'Status': 'SUCCESS',
                'PhysicalResourceId': event['PhysicalResourceId']
            }
            
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return {
            'Status': 'FAILED',
            'PhysicalResourceId': event.get('PhysicalResourceId', 'identity-center-finder'),
            'Reason': str(e)
        }
`),
        timeout: cdk.Duration.minutes(2),
        role: new iam.Role(this, "IdentityCenterFinderRole", {
          assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
          managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
          inlinePolicies: {
            SSOAccess: new iam.PolicyDocument({
              statements: [
                new iam.PolicyStatement({
                  effect: iam.Effect.ALLOW,
                  actions: ["sso:ListInstances", "sso-admin:ListInstances"],
                  resources: ["*"],
                }),
              ],
            }),
          },
        }),
      })

      // Custom resource to find Identity Center ARN
      const identityCenterCustomResource = new cdk.CustomResource(this, "IdentityCenterCustomResource", {
        serviceToken: identityCenterFinder.functionArn,
      })

      identityCenterInstanceArn = identityCenterCustomResource.getAttString("InstanceArn")
    }

    // S3 Bucket for data sources
    const dataBucket = new s3.Bucket(this, "DataSourceBucket", {
      bucketName: `${projectName}-data-sources-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    // Deploy URL files from the repository to S3
    const urlFilesDeployment = new s3deploy.BucketDeployment(this, "DeployUrlFiles", {
      sources: [s3deploy.Source.asset(`./${urlFilesPath}`)], // Add ./ prefix
      destinationBucket: dataBucket,
      destinationKeyPrefix: "url-sources/",
      include: ["*.txt"], // Use include instead of exclude for clarity
    })

    // IAM Role for Q Business Data Source
    const dataSourceRole = new iam.Role(this, "QBusinessDataSourceRole", {
      assumedBy: new iam.ServicePrincipal("qbusiness.amazonaws.com"),
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetObject", "s3:ListBucket"],
              resources: [dataBucket.bucketArn, `${dataBucket.bucketArn}/*`],
            }),
          ],
        }),
        QBusinessAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "qbusiness:CreateDataSource",
                "qbusiness:DeleteDataSource",
                "qbusiness:UpdateDataSource",
                "qbusiness:ListDataSources",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["iam:PassRole"],
              resources: [dataSourceRole.roleArn],
            }),
          ],
        }),
      },
    })

    // IAM Role for Q Business Application
    const qBusinessRole = new iam.Role(this, "QBusinessApplicationRole", {
      assumedBy: new iam.ServicePrincipal("qbusiness.amazonaws.com"),
      inlinePolicies: {
        QBusinessApplicationPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "qbusiness:*",
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetObject", "s3:ListBucket"],
              resources: [dataBucket.bucketArn, `${dataBucket.bucketArn}/*`],
            }),
          ],
        }),
      },
    })

    // Q Business Application
    const qBusinessApp = new qbusiness.CfnApplication(this, "QBusinessApplication", {
      displayName: `${projectName}-app`,
      description: "Catholic Charities AI Assistant Q Business Application",
      roleArn: qBusinessRole.roleArn,
      identityCenterInstanceArn: identityCenterInstanceArn,
      attachmentsConfiguration: {
        attachmentsControlMode: "ENABLED",
      },
    })

    // Q Business Index
    const qBusinessIndex = new qbusiness.CfnIndex(this, "QBusinessIndex", {
      applicationId: qBusinessApp.attrApplicationId,
      displayName: `${projectName}-index`,
      description: "Main index for Catholic Charities content",
      type: "STARTER",
      capacityConfiguration: {
        units: 1,
      },
    })

    // Q Business Data Sources - Create one for each URL file
    const dataSourceCreator = new lambda.Function(this, "DataSourceCreator", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "index.handler",
      code: lambda.Code.fromInline(`import boto3
import json
import logging
import time
import urllib3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')
qbusiness_client = boto3.client('qbusiness')

def send_response(event, context, response_status, response_data=None, physical_resource_id=None, reason=None):
    """Send response to CloudFormation"""
    if response_data is None:
        response_data = {}
    
    response_url = event['ResponseURL']
    
    response_body = {
        'Status': response_status,
        'Reason': reason or f'See CloudWatch Log Stream: {context.log_stream_name}',
        'PhysicalResourceId': physical_resource_id or context.log_stream_name,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': response_data
    }
    
    json_response_body = json.dumps(response_body)
    
    headers = {
        'content-type': '',
        'content-length': str(len(json_response_body))
    }
    
    try:
        http = urllib3.PoolManager()
        response = http.request('PUT', response_url, body=json_response_body, headers=headers)
        logger.info(f"CloudFormation response sent successfully: {response.status}")
    except Exception as e:
        logger.error(f"Failed to send response to CloudFormation: {str(e)}")

def handler(event, context):
    try:
        request_type = event['RequestType']
        logger.info(f"Request type: {request_type}")
        
        if request_type == 'Create' or request_type == 'Update':
            bucket_name = event['ResourceProperties']['BucketName']
            application_id = event['ResourceProperties']['ApplicationId']
            index_id = event['ResourceProperties']['IndexId']
            data_source_role_arn = event['ResourceProperties']['DataSourceRoleArn']
            project_name = event['ResourceProperties']['ProjectName']
            
            logger.info(f"Processing bucket: {bucket_name}")
            logger.info(f"Application ID: {application_id}")
            logger.info(f"Index ID: {index_id}")
            
            # Wait a bit for S3 deployment to complete
            time.sleep(10)
            
            # List all .txt files in the url-sources/ prefix
            try:
                response = s3_client.list_objects_v2(
                    Bucket=bucket_name,
                    Prefix='url-sources/'
                )
                logger.info(f"S3 list response: {response}")
            except Exception as e:
                logger.error(f"Failed to list S3 objects: {str(e)}")
                send_response(event, context, 'FAILED', reason=f"Failed to list S3 objects: {str(e)}")
                return
            
            data_sources = []
            
            if 'Contents' in response:
                logger.info(f"Found {len(response['Contents'])} objects in S3")
                for obj in response['Contents']:
                    key = obj['Key']
                    logger.info(f"Processing S3 object: {key}")
                    if key.endswith('.txt') and key != 'url-sources/':
                        file_name = key.split('/')[-1]
                        base_name = file_name.replace('.txt', '')
                        
                        try:
                            # Read URLs from the file
                            file_response = s3_client.get_object(Bucket=bucket_name, Key=key)
                            content = file_response['Body'].read().decode('utf-8').strip()
                            urls = [url.strip() for url in content.split('\\n') if url.strip() and not url.strip().startswith('#')]
                            
                            logger.info(f"Found {len(urls)} URLs in {file_name}: {urls}")
                            
                            if urls:
                                # Create Q Business data source with correct API structure
                                data_source_response = qbusiness_client.create_data_source(
                                    applicationId=application_id,
                                    indexId=index_id,
                                    displayName=f"{project_name}-{base_name}",
                                    description=f"Web crawler for {base_name} URLs",
                                    roleArn=data_source_role_arn,
                                    configuration={
                                        'webCrawlerConfiguration': {
                                            'urlConfiguration': {
                                                'seedUrlConfiguration': {
                                                    'seedUrls': urls
                                                }
                                            },
                                            'crawlDepth': 2,
                                            'maxLinksPerPage': 100,
                                            'maxContentSizePerPageInMegaBytes': 50,
                                            'inclusionPatterns': ['.*'],
                                            'exclusionPatterns': []
                                        }
                                    },
                                    syncSchedule='rate(7 days)'
                                )
                                
                                data_sources.append({
                                    'id': data_source_response['dataSourceId'],
                                    'name': base_name,
                                    'urls': len(urls)
                                })
                                
                                logger.info(f"Created data source {base_name} with ID {data_source_response['dataSourceId']}")
                        except Exception as e:
                            logger.error(f"Failed to process file {key}: {str(e)}")
                            # Continue with other files instead of failing completely
                            continue
            else:
                logger.warning("No objects found in S3 bucket url-sources/ prefix")
            
            logger.info(f"Created {len(data_sources)} data sources total")
            
            # Send success response to CloudFormation
            send_response(event, context, 'SUCCESS', {
                'DataSources': json.dumps(data_sources),
                'DataSourceCount': str(len(data_sources))
            }, f"{application_id}-data-sources")
            
        elif request_type == 'Delete':
            # Clean up data sources if needed
            logger.info("Delete request - cleaning up")
            send_response(event, context, 'SUCCESS', {}, event.get('PhysicalResourceId', 'deleted'))
            
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        send_response(event, context, 'FAILED', reason=str(e))
`),
      timeout: cdk.Duration.minutes(10), // Increase timeout
      role: new iam.Role(this, "DataSourceCreatorRole", {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
        inlinePolicies: {
          S3Access: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["s3:GetObject", "s3:ListBucket"],
                resources: [dataBucket.bucketArn, `${dataBucket.bucketArn}/*`],
              }),
            ],
          }),
          QBusinessAccess: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  "qbusiness:CreateDataSource",
                  "qbusiness:DeleteDataSource",
                  "qbusiness:UpdateDataSource",
                  "qbusiness:ListDataSources",
                ],
                resources: ["*"],
              }),
            ],
          }),
        },
      }),
    })

    // Custom resource to create data sources
    const dataSourcesCustomResource = new cdk.CustomResource(this, "DataSourcesCustomResource", {
      serviceToken: dataSourceCreator.functionArn,
      properties: {
        BucketName: dataBucket.bucketName,
        ApplicationId: qBusinessApp.attrApplicationId,
        IndexId: qBusinessIndex.attrIndexId,
        DataSourceRoleArn: dataSourceRole.roleArn,
        ProjectName: projectName,
      },
    })

    // Ensure the custom resource runs after the URL files are deployed
    dataSourcesCustomResource.node.addDependency(urlFilesDeployment)
    dataSourcesCustomResource.node.addDependency(qBusinessApp)
    dataSourcesCustomResource.node.addDependency(qBusinessIndex)

    // Lambda Execution Role
    const lambdaRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
      inlinePolicies: {
        QBusinessAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["qbusiness:ChatSync", "qbusiness:Chat"],
              resources: [
                `arn:aws:qbusiness:${this.region}:${this.account}:application/${qBusinessApp.attrApplicationId}`,
              ],
            }),
          ],
        }),
      },
    })

    // Lambda Function
    const chatLambda = new lambda.Function(this, "ChatLambdaFunction", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "lambda_function.lambda_handler",
      code: lambda.Code.fromAsset("lambda"),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        QBUSINESS_APPLICATION_ID: qBusinessApp.attrApplicationId,
        DEBUG: "false",
      },
      description: "Catholic Charities Q Business Chat Handler",
    })

    // API Gateway
    const api = new apigateway.RestApi(this, "ChatAPI", {
      restApiName: `${projectName}-api`,
      description: "Catholic Charities Chatbot API",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "X-Amz-Date", "Authorization", "X-Api-Key", "X-Amz-Security-Token"],
      },
    })

    // API Gateway Integration
    const lambdaIntegration = new apigateway.LambdaIntegration(chatLambda, {
      requestTemplates: { "application/json": '{ "statusCode": "200" }' },
    })

    // API Routes
    const chatResource = api.root.addResource("chat")
    chatResource.addMethod("POST", lambdaIntegration)

    const healthResource = api.root.addResource("health")
    healthResource.addMethod("GET", lambdaIntegration)

    // Amplify App for Frontend
    const amplifyApp = new amplify.CfnApp(this, "AmplifyApp", {
      name: `${projectName}-frontend`,
      description: "Catholic Charities Chatbot Frontend",
      repository: `https://github.com/${props.githubOwner}/${props.githubRepo}`,
      accessToken: props.githubToken,
      buildSpec: `version: 1
applications:
  - frontend:
      phases:
        preBuild:
          commands:
            - cd Frontend
            - npm ci
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: Frontend/build
        files:
          - '**/*'
      cache:
        paths:
          - Frontend/node_modules/**/*`,
      environmentVariables: [
        {
          name: "REACT_APP_API_BASE_URL",
          value: api.url,
        },
        {
          name: "REACT_APP_CHAT_ENDPOINT",
          value: `${api.url}chat`,
        },
        {
          name: "REACT_APP_HEALTH_ENDPOINT",
          value: `${api.url}health`,
        },
      ],
    })

    // Main branch
    const mainBranch = new amplify.CfnBranch(this, "MainBranch", {
      appId: amplifyApp.attrAppId,
      branchName: "main",
      enableAutoBuild: true,
      stage: "PRODUCTION",
    })

    // Outputs
    new cdk.CfnOutput(this, "QBusinessApplicationId", {
      value: qBusinessApp.attrApplicationId,
      description: "Q Business Application ID",
    })

    new cdk.CfnOutput(this, "QBusinessIndexId", {
      value: qBusinessIndex.attrIndexId,
      description: "Q Business Index ID",
    })

    new cdk.CfnOutput(this, "DataSourceId", {
      value: dataSourcesCustomResource.getAttString("DataSources"),
      description: "Q Business Data Source ID",
    })

    new cdk.CfnOutput(this, "APIGatewayURL", {
      value: api.url,
      description: "API Gateway URL",
    })

    new cdk.CfnOutput(this, "ChatEndpoint", {
      value: `${api.url}chat`,
      description: "Chat API Endpoint",
    })

    new cdk.CfnOutput(this, "HealthEndpoint", {
      value: `${api.url}health`,
      description: "Health Check Endpoint",
    })

    new cdk.CfnOutput(this, "AmplifyAppId", {
      value: amplifyApp.attrAppId,
      description: "Amplify App ID",
    })

    new cdk.CfnOutput(this, "AmplifyAppURL", {
      value: `https://${mainBranch.branchName}.${mainBranch.attrBranchName}.${amplifyApp.attrDefaultDomain}`,
      description: "Amplify App URL",
    })

    new cdk.CfnOutput(this, "S3BucketName", {
      value: dataBucket.bucketName,
      description: "S3 Data Source Bucket Name",
    })

    new cdk.CfnOutput(this, "IdentityCenterInstanceArn", {
      value: identityCenterInstanceArn,
      description: "Identity Center Instance ARN used",
    })
  }
}
