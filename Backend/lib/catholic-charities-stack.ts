import * as cdk from "aws-cdk-lib"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as apigateway from "aws-cdk-lib/aws-apigateway"
import * as iam from "aws-cdk-lib/aws-iam"
import * as qbusiness from "aws-cdk-lib/aws-qbusiness"
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment"
import * as amplify from "aws-cdk-lib/aws-amplify"
import * as events from "aws-cdk-lib/aws-events"
import * as targets from "aws-cdk-lib/aws-events-targets"
import type { Construct } from "constructs"

export interface CatholicCharitiesStackProps extends cdk.StackProps {
  readonly githubOwner: string
  readonly githubRepo: string
  readonly githubToken: string
  readonly projectName?: string
  readonly urlFilesPath?: string
  readonly identityCenterInstanceArn?: string
}

export class CatholicCharitiesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CatholicCharitiesStackProps) {
    super(scope, id, props)

    const projectName = props.projectName || "catholic-charities-chatbot"
    const urlFilesPath = props.urlFilesPath || "data-sources"

    // S3 Buckets
    const dataBucket = new s3.Bucket(this, "DataSourceBucket", {
      bucketName: `${projectName}-data-${this.account}-${this.region}`.substring(0, 63),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    const frontendBucket = new s3.Bucket(this, "FrontendBuildBucket", {
      bucketName: `${projectName}-builds-${this.account}-${this.region}`.substring(0, 63),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      eventBridgeEnabled: true,
    })

    // Deploy URL files to S3
    const urlFilesDeployment = new s3deploy.BucketDeployment(this, "DeployUrlFiles", {
      sources: [s3deploy.Source.asset(`./${urlFilesPath}`)],
      destinationBucket: dataBucket,
      include: ["*.txt"],
    })

    // Q Business Application Setup
    const applicationRole = new iam.Role(this, "QBusinessApplicationRole", {
      assumedBy: new iam.ServicePrincipal("qbusiness.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: {
            "aws:SourceArn": `arn:aws:qbusiness:${this.region}:${this.account}:application/*`,
          },
        },
      }),
      inlinePolicies: {
        QBusinessApplicationPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "AmazonQApplicationPutMetricDataPermission",
              actions: ["cloudwatch:PutMetricData"],
              resources: ["*"],
              conditions: {
                StringEquals: { "cloudwatch:namespace": "AWS/QBusiness" },
              },
            }),
            new iam.PolicyStatement({
              sid: "AmazonQApplicationDescribeLogGroupsPermission",
              actions: ["logs:DescribeLogGroups"],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              sid: "AmazonQApplicationCreateLogGroupPermission",
              actions: ["logs:CreateLogGroup"],
              resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/qbusiness/*`],
            }),
            new iam.PolicyStatement({
              sid: "AmazonQApplicationLogStreamPermission",
              actions: ["logs:DescribeLogStreams", "logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/qbusiness/*:log-stream:*`],
            }),
          ],
        }),
      },
    })

    const qBusinessApp = new qbusiness.CfnApplication(this, "QBusinessApplication", {
      displayName: `${projectName}-app`,
      description: "Catholic Charities AI Assistant Q Business Application",
      roleArn: applicationRole.roleArn,
      identityType: "ANONYMOUS",
    })

    const qBusinessIndex = new qbusiness.CfnIndex(this, "QBusinessIndex", {
      applicationId: qBusinessApp.attrApplicationId,
      displayName: `${projectName}-index`,
      description: "Main index for Catholic Charities content",
      type: "STARTER",
      capacityConfiguration: {
        units: 1,
      },
    })

    const qBusinessRetriever = new qbusiness.CfnRetriever(this, "QBusinessRetriever", {
      applicationId: qBusinessApp.attrApplicationId,
      displayName: `${projectName}-retriever`,
      type: "NATIVE_INDEX",
      configuration: {
        nativeIndexConfiguration: {
          indexId: qBusinessIndex.attrIndexId,
        },
      },
    })

    // Web Crawler Role
    const webCrawlerRole = new iam.Role(this, "WebCrawlerRole", {
      assumedBy: new iam.ServicePrincipal("qbusiness.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnEquals: { "aws:SourceArn": qBusinessApp.attrApplicationArn },
        },
      }),
      inlinePolicies: {
        WebCrawlerPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["qbusiness:BatchPutDocument", "qbusiness:BatchDeleteDocument"],
              resources: [
                qBusinessApp.attrApplicationArn,
                qBusinessIndex.attrIndexArn,
                `${qBusinessIndex.attrIndexArn}/data-source/*`,
              ],
            }),
          ],
        }),
      },
    })

    // Data Source Creator Lambda
    const dataSourceCreatorRole = new iam.Role(this, "DataSourceCreatorRole", {
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
                "qbusiness:StartDataSourceSyncJob",
                "qbusiness:StopDataSourceSyncJob",
                "qbusiness:ListDataSourceSyncJobs",
              ],
              resources: ["*"],
            }),
          ],
        }),
        PassRolePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["iam:PassRole"],
              resources: [webCrawlerRole.roleArn],
            }),
          ],
        }),
      },
    })

    const dataSourceCreator = new lambda.Function(this, "DataSourceCreator", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "index.handler",
      code: lambda.Code.fromInline(`
import boto3
import json
import logging
import time
import urllib3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')
qbusiness_client = boto3.client('qbusiness')

def send_response(event, context, response_status, response_data=None, physical_resource_id=None, reason=None):
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
            web_crawler_role_arn = event['ResourceProperties']['WebCrawlerRoleArn']
            project_name = event['ResourceProperties']['ProjectName']
            
            logger.info(f"Processing bucket: {bucket_name}")
            
            time.sleep(10)
            
            try:
                response = s3_client.list_objects_v2(Bucket=bucket_name)
            except Exception as e:
                logger.error(f"Failed to list S3 objects: {str(e)}")
                send_response(event, context, 'FAILED', reason=f"Failed to list S3 objects: {str(e)}")
                return
            
            data_sources = []
            
            if 'Contents' in response:
                for obj in response['Contents']:
                    key = obj['Key']
                    if key.endswith('.txt'):
                        file_name = key
                        base_name = file_name.replace('.txt', '')
                        
                        try:
                            file_response = s3_client.get_object(Bucket=bucket_name, Key=key)
                            content = file_response['Body'].read().decode('utf-8').strip()
                            urls = [url.strip() for url in content.split('\\n') if url.strip() and not url.strip().startswith('#')]
                            
                            if urls:
                                data_source_response = qbusiness_client.create_data_source(
                                    applicationId=application_id,
                                    indexId=index_id,
                                    displayName=f"{project_name}-{base_name}",
                                    description=f"Web crawler for {base_name} URLs",
                                    roleArn=web_crawler_role_arn,
                                    configuration={
                                        'type': 'WEBCRAWLERV2',
                                        'syncMode': 'FORCED_FULL_CRAWL',
                                        'connectionConfiguration': {
                                            'repositoryEndpointMetadata': {
                                                'authentication': 'NoAuthentication',
                                                'seedUrlConnections': [{'seedUrl': url} for url in urls],
                                            },
                                        },
                                        'repositoryConfigurations': {
                                            'webPage': {
                                                'fieldMappings': [
                                                    {
                                                        'indexFieldName': '_source_uri',
                                                        'indexFieldType': 'STRING',
                                                        'dataSourceFieldName': 'sourceUrl',
                                                    },
                                                    {
                                                        'indexFieldName': '_document_title',
                                                        'indexFieldType': 'STRING',
                                                        'dataSourceFieldName': 'title',
                                                    },
                                                ],
                                            },
                                        },
                                        'additionalProperties': {
                                            'rateLimit': '300',
                                            'maxFileSize': '50',
                                            'crawlDepth': '2',
                                            'maxLinksPerUrl': '100',
                                            'crawlSubDomain': True,
                                            'crawlAllDomain': False,
                                            'honorRobots': True,
                                            'crawlAttachments': False,
                                        },
                                    }
                                )
                                
                                data_source_id = data_source_response['dataSourceId']
                                data_sources.append({
                                    'id': data_source_id,
                                    'name': base_name,
                                    'urls': len(urls)
                                })
                                
                                logger.info(f"Created data source {base_name} with ID {data_source_id}")
                        except Exception as e:
                            logger.error(f"Failed to process file {key}: {str(e)}")
                            continue
            
            send_response(event, context, 'SUCCESS', {
                'DataSources': json.dumps(data_sources),
                'DataSourceCount': str(len(data_sources))
            }, f"{application_id}-data-sources")
            
        elif request_type == 'Delete':
            send_response(event, context, 'SUCCESS', {}, event.get('PhysicalResourceId', 'deleted'))
            
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        send_response(event, context, 'FAILED', reason=str(e))
`),
      timeout: cdk.Duration.minutes(15),
      role: dataSourceCreatorRole,
    })

    const dataSourcesCustomResource = new cdk.CustomResource(this, "DataSourcesCustomResource", {
      serviceToken: dataSourceCreator.functionArn,
      properties: {
        BucketName: dataBucket.bucketName,
        ApplicationId: qBusinessApp.attrApplicationId,
        IndexId: qBusinessIndex.attrIndexId,
        WebCrawlerRoleArn: webCrawlerRole.roleArn,
        ProjectName: projectName,
      },
    })

    dataSourcesCustomResource.node.addDependency(urlFilesDeployment)

    // Chat Lambda Function
    const lambdaRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
      inlinePolicies: {
        QBusinessFullAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "qbusiness:ChatSync",
                "qbusiness:Chat",
                "qbusiness:GetApplication",
                "qbusiness:ListApplications",
                "qbusiness:GetRetriever",
                "qbusiness:ListRetrievers",
                "qbusiness:GetIndex",
                "qbusiness:ListIndices",
              ],
              resources: ["*"],
            }),
          ],
        }),
      },
    })

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

    const lambdaIntegration = new apigateway.LambdaIntegration(chatLambda)
    const chatResource = api.root.addResource("chat")
    chatResource.addMethod("POST", lambdaIntegration)
    const healthResource = api.root.addResource("health")
    healthResource.addMethod("GET", lambdaIntegration)

    // Amplify App (created in CloudFormation, not buildspec)
    const amplifyApp = new amplify.CfnApp(this, "AmplifyApp", {
      name: `${projectName}-frontend`,
      platform: "WEB",
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
      customRules: [
        {
          source: "/<*>",
          target: "/index.html",
          status: "200",
        },
      ],
    })

    // Amplify Branch
    const amplifyBranch = new amplify.CfnBranch(this, "AmplifyBranch", {
      appId: amplifyApp.attrAppId,
      branchName: "main",
      stage: "PRODUCTION",
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

    // FIXED: Lambda function to handle EventBridge events (not S3 direct events)
    const amplifyDeployerRole = new iam.Role(this, "AmplifyDeployerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
      inlinePolicies: {
        AmplifyAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "amplify:StartDeployment",
                "amplify:GetApp",
                "amplify:GetBranch",
                "amplify:ListApps",
                "amplify:ListBranches",
              ],
              resources: ["*"],
            }),
          ],
        }),
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetObject", "s3:GetObjectVersion"],
              resources: [`${frontendBucket.bucketArn}/*`],
            }),
          ],
        }),
      },
    })

    const amplifyDeployer = new lambda.Function(this, "AmplifyDeployer", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "index.handler",
      code: lambda.Code.fromInline(`
import boto3
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

amplify_client = boto3.client('amplify')

def handler(event, context):
    try:
        logger.info(f"Received EventBridge event: {json.dumps(event)}")
        
        # Handle EventBridge event format (not S3 direct event)
        if event.get('source') == 'aws.s3' and event.get('detail-type') == 'Object Created':
            detail = event.get('detail', {})
            bucket_name = detail.get('bucket', {}).get('name')
            object_key = detail.get('object', {}).get('key')
            
            logger.info(f"Processing S3 object: {bucket_name}/{object_key}")
            
            # Check if this is a build.zip file
            if object_key and object_key.startswith('builds/') and object_key.endswith('.zip'):
                app_id = "${amplifyApp.attrAppId}"
                branch_name = "main"
                
                logger.info(f"Starting Amplify deployment for app {app_id}, branch {branch_name}")
                
                # Start deployment with S3 source
                response = amplify_client.start_deployment(
                    appId=app_id,
                    branchName=branch_name,
                    sourceUrl=f"s3://{bucket_name}/{object_key}"
                )
                
                job_id = response['jobSummary']['jobId']
                logger.info(f"✅ Started Amplify deployment with job ID: {job_id}")
                
                return {
                    'statusCode': 200,
                    'body': json.dumps({
                        'message': 'Deployment started successfully',
                        'jobId': job_id,
                        'appId': app_id,
                        'branchName': branch_name,
                        'sourceUrl': f"s3://{bucket_name}/{object_key}"
                    })
                }
            else:
                logger.info(f"Skipping non-build file: {object_key}")
        else:
            logger.info(f"Skipping non-S3 event: {event.get('source')}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'Event processed, no action needed'})
        }
        
    except Exception as e:
        logger.error(f"❌ Error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
`),
      timeout: cdk.Duration.minutes(5),
      role: amplifyDeployerRole,
      environment: {
        AMPLIFY_APP_ID: amplifyApp.attrAppId,
      },
    })

    // EventBridge rule to trigger deployment when build.zip is uploaded
    const s3UploadRule = new events.Rule(this, "S3BuildUploadRule", {
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: {
            name: [frontendBucket.bucketName],
          },
          object: {
            key: [{ prefix: "builds/" }, { suffix: ".zip" }],
          },
        },
      },
    })

    s3UploadRule.addTarget(new targets.LambdaFunction(amplifyDeployer))

    // Grant EventBridge permission to invoke the Lambda
    amplifyDeployer.addPermission("AllowEventBridgeInvoke", {
      principal: new iam.ServicePrincipal("events.amazonaws.com"),
      sourceArn: s3UploadRule.ruleArn,
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

    new cdk.CfnOutput(this, "QBusinessRetrieverId", {
      value: qBusinessRetriever.attrRetrieverId,
      description: "Q Business Retriever ID",
    })

    new cdk.CfnOutput(this, "DataSourceInfo", {
      value: dataSourcesCustomResource.getAttString("DataSources"),
      description: "Q Business Data Sources Info",
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

    new cdk.CfnOutput(this, "S3BucketName", {
      value: dataBucket.bucketName,
      description: "S3 Data Source Bucket Name",
    })

    new cdk.CfnOutput(this, "FrontendBuildBucketName", {
      value: frontendBucket.bucketName,
      description: "S3 Bucket for Frontend Build Artifacts",
    })

    new cdk.CfnOutput(this, "AmplifyAppId", {
      value: amplifyApp.attrAppId,
      description: "Amplify App ID",
    })

    new cdk.CfnOutput(this, "AmplifyAppURL", {
      value: `https://main.${amplifyApp.attrAppId}.amplifyapp.com`,
      description: "Amplify App URL",
    })
  }
}
