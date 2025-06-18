import * as cdk from "aws-cdk-lib"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as apigateway from "aws-cdk-lib/aws-apigateway"
import * as iam from "aws-cdk-lib/aws-iam"
import * as qbusiness from "aws-cdk-lib/aws-qbusiness"
import * as events from "aws-cdk-lib/aws-events"
import * as targets from "aws-cdk-lib/aws-events-targets"
import type { Construct } from "constructs"

export interface CatholicCharitiesStackProps extends cdk.StackProps {
  readonly githubOwner: string
  readonly githubRepo: string
  readonly projectName?: string
  readonly urlFilesPath?: string
  readonly amplifyAppName?: string
  readonly amplifyBranchName?: string
}

export class CatholicCharitiesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CatholicCharitiesStackProps) {
    super(scope, id, props)

    const projectName = props.projectName || "catholic-charities-chatbot"
    const urlFilesPath = props.urlFilesPath || "data-sources"
    const amplifyAppName = props.amplifyAppName || `${projectName}-frontend`
    const amplifyBranchName = props.amplifyBranchName || "main"

    // S3 Buckets (simplified - no auto-delete to reduce Lambda functions)
    const dataBucket = new s3.Bucket(this, "DataSourceBucket", {
      bucketName: `${projectName}-data-${this.account}-${this.region}`.substring(0, 63),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    const frontendBucket = new s3.Bucket(this, "FrontendBuildBucket", {
      bucketName: `${projectName}-builds-${this.account}-${this.region}`.substring(0, 63),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      eventBridgeEnabled: true,
    })

    // Add bucket policy to allow Amplify service access
    frontendBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowAmplifyServiceAccess",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("amplify.amazonaws.com")],
        actions: [
          "s3:GetObject",
          "s3:GetObjectAcl",
          "s3:GetObjectVersion",
          "s3:ListBucket",
          "s3:GetBucketAcl",
          "s3:GetBucketLocation",
        ],
        resources: [`${frontendBucket.bucketArn}/*`, frontendBucket.bucketArn],
        conditions: {
          StringEquals: {
            "aws:SourceAccount": this.account,
          },
        },
      }),
    )

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

    // LAMBDA 1: Chat Lambda Function (Essential)
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

    // LAMBDA 2: Amplify Deployer (Essential)
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
                "amplify:GetJob",
                "amplify:ListJobs",
              ],
              resources: ["*"],
            }),
          ],
        }),
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "s3:GetObject",
                "s3:GetObjectVersion",
                "s3:GetObjectAcl",
                "s3:GetObjectVersionAcl",
                "s3:PutObjectAcl",
                "s3:PutObjectVersionAcl",
                "s3:ListBucket",
                "s3:GetBucketAcl",
                "s3:GetBucketLocation",
                "s3:GetBucketVersioning",
                "s3:PutBucketAcl",
                "s3:ListBucketVersions",
                "s3:GetBucketPolicy",
                "s3:GetBucketPolicyStatus",
                "s3:GetBucketPublicAccessBlock",
                "s3:GetEncryptionConfiguration",
              ],
              resources: [frontendBucket.bucketArn, `${frontendBucket.bucketArn}/*`],
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
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

amplify_client = boto3.client('amplify')

def handler(event, context):
    try:
        logger.info(f"Received EventBridge event: {json.dumps(event)}")
        
        if event.get('source') == 'aws.s3' and event.get('detail-type') == 'Object Created':
            detail = event.get('detail', {})
            bucket_name = detail.get('bucket', {}).get('name')
            object_key = detail.get('object', {}).get('key')
            
            logger.info(f"Processing S3 object: {bucket_name}/{object_key}")
            
            if object_key and object_key.startswith('builds/') and object_key.endswith('.zip'):
                app_id = os.environ.get('AMPLIFY_APP_ID')
                branch_name = os.environ.get('AMPLIFY_BRANCH_NAME', 'main')
                
                if not app_id or app_id == 'placeholder':
                    logger.error("AMPLIFY_APP_ID environment variable not set")
                    return {
                        'statusCode': 400,
                        'body': json.dumps({'error': 'AMPLIFY_APP_ID not configured'})
                    }
                
                logger.info(f"Starting Amplify deployment for app {app_id}, branch {branch_name}")
                
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
        AMPLIFY_APP_ID: "placeholder", // Will be updated by buildspec
        AMPLIFY_BRANCH_NAME: amplifyBranchName,
        AMPLIFY_APP_NAME: amplifyAppName,
      },
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

    new cdk.CfnOutput(this, "WebCrawlerRoleArn", {
      value: webCrawlerRole.roleArn,
      description: "Web Crawler Role ARN for Data Sources",
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

    new cdk.CfnOutput(this, "AmplifyDeployerFunctionName", {
      value: amplifyDeployer.functionName,
      description: "Amplify Deployer Lambda Function Name",
    })

    new cdk.CfnOutput(this, "AmplifyAppName", {
      value: amplifyAppName,
      description: "Amplify App Name",
    })

    new cdk.CfnOutput(this, "AmplifyBranchName", {
      value: amplifyBranchName,
      description: "Amplify Branch Name",
    })
  }
}
