import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as amplify from "aws-cdk-lib/aws-amplify";
import * as qbusiness from "aws-cdk-lib/aws-qbusiness";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as path from "path";
import type { Construct } from "constructs";

export interface CatholicCharitiesStackProps extends cdk.StackProps {
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly githubToken: string;
  readonly projectName?: string;
  readonly urlFilesPath?: string;
  readonly identityCenterInstanceArn?: string;
}

export class CatholicCharitiesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CatholicCharitiesStackProps) {
    super(scope, id, props);

    const projectName = props.projectName || "catholic-charities-chatbot";
    const urlFilesPath = props.urlFilesPath || "data-sources";

    // Handle Identity Center ARN
    const identityCenterInstanceArn = props.identityCenterInstanceArn;

    // S3 Bucket for data sources
    const dataBucket = new s3.Bucket(this, "DataSourceBucket", {
      bucketName: `${projectName}-data-sources-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Deploy URL files to S3
    const urlFilesDeployment = new s3deploy.BucketDeployment(this, "DeployUrlFiles", {
      sources: [s3deploy.Source.asset(path.resolve(__dirname, "..", urlFilesPath))],
      destinationBucket: dataBucket,
      destinationKeyPrefix: "url-sources/",
      exclude: ["*", "!*.txt"],
    });

    // IAM Role for Q Business Application
    const qBusinessRole = new iam.Role(this, "QBusinessApplicationRole", {
      assumedBy: new iam.ServicePrincipal("qbusiness.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: { "aws:SourceArn": `arn:aws:qbusiness:${this.region}:${this.account}:application/*` },
        },
      }),
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
    });

    // Q Business Application
    const qBusinessApp = new qbusiness.CfnApplication(this, "QBusinessApplication", {
      displayName: `${projectName}-app`,
      description: "Catholic Charities AI Assistant Q Business Application",
      roleArn: qBusinessRole.roleArn,
      identityCenterInstanceArn,
      attachmentsConfiguration: {
        attachmentsControlMode: "ENABLED",
      },
    });

    // Q Business Index
    const qBusinessIndex = new qbusiness.CfnIndex(this, "QBusinessIndex", {
      applicationId: qBusinessApp.attrApplicationId,
      displayName: `${projectName}-index`,
      description: "Main index for Catholic Charities content",
      type: "STARTER",
      capacityConfiguration: {
        units: 1,
      },
    });

    // IAM Role for Q Business Data Source
    const dataSourceRole = new iam.Role(this, "QBusinessDataSourceRole", {
      assumedBy: new iam.ServicePrincipal("qbusiness.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: { "aws:SourceArn": `arn:aws:qbusiness:${this.region}:${this.account}:application/*` },
        },
      }),
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
                "qbusiness:UpdateDataSource",
                "qbusiness:DeleteDataSource",
                "qbusiness:StartDataSourceSyncJob",
                "qbusiness:StopDataSourceSyncJob",
                "qbusiness:BatchPutDocument",
                "qbusiness:BatchDeleteDocument",
              ],
              resources: [
                `arn:aws:qbusiness:${this.region}:${this.account}:application/${qBusinessApp.attrApplicationId}/*`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    // Data Source Creator Lambda
    const dataSourceCreator = new lambda.Function(this, "DataSourceCreator", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "index.handler",
      code: lambda.Code.fromInline(`
import boto3
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')
qbusiness_client = boto3.client('qbusiness')

def handler(event, context):
    try:
        request_type = event['RequestType']
        if request_type == 'Create' or request_type == 'Update':
            bucket_name = event['ResourceProperties']['BucketName']
            application_id = event['ResourceProperties']['ApplicationId']
            index_id = event['ResourceProperties']['IndexId']
            data_source_role_arn = event['ResourceProperties']['DataSourceRoleArn']
            project_name = event['ResourceProperties']['ProjectName']
            
            # List .txt files in url-sources/
            response = s3_client.list_objects_v2(
                Bucket=bucket_name,
                Prefix='url-sources/',
                Delimiter='/'
            )
            
            data_sources = []
            if 'Contents' not in response:
                logger.warning("No .txt files found in url-sources/")
                return {
                    'Status': 'SUCCESS',
                    'PhysicalResourceId': f"{application_id}-data-sources",
                    'Data': {'DataSources': json.dumps(data_sources)},
                    'Reason': 'No .txt files found in S3 bucket'
                }
            
            for obj in response['Contents']:
                key = obj['Key']
                if key.endswith('.txt'):
                    file_name = key.split('/')[-1]
                    base_name = file_name.replace('.txt', '')
                    
                    # Create S3 data source
                    data_source_response = qbusiness_client.create_data_source(
                        applicationId=application_id,
                        indexId=index_id,
                        displayName=f"{project_name}-{base_name}",
                        description=f"S3 data source for {base_name} URLs",
                        type='S3',
                        roleArn=data_source_role_arn,
                        configuration={
                            'type': 'S3',
                            'connectionConfiguration': {
                                'repositoryEndpointMetadata': {
                                    'bucketName': bucket_name
                                }
                            },
                            'repositoryConfigurations': {
                                'document': {
                                    'fieldMappings': [
                                        {
                                            'indexFieldName': '_source_uri',
                                            'indexFieldType': 'STRING',
                                            'dataSourceFieldName': 'sourceUri'
                                        },
                                        {
                                            'indexFieldName': 'content',
                                            'indexFieldType': 'STRING',
                                            'dataSourceFieldName': 'content'
                                        }
                                    ]
                                }
                            },
                            'additionalProperties': {
                                'inclusionPrefixes': [f'url-sources/{file_name}']
                            }
                        },
                        syncSchedule='ON_DEMAND'
                    )
                    
                    # Start sync job
                    qbusiness_client.start_data_source_sync_job(
                        applicationId=application_id,
                        indexId=index_id,
                        dataSourceId=data_source_response['dataSourceId']
                    )
                    
                    data_sources.append({
                        'id': data_source_response['dataSourceId'],
                        'name': base_name,
                        'file': file_name
                    })
                    logger.info(f"Created S3 data source {base_name} for {file_name}")
            
            return {
                'Status': 'SUCCESS',
                'PhysicalResourceId': f"{application_id}-data-sources",
                'Data': {'DataSources': json.dumps(data_sources)}
            }
        elif request_type == 'Delete':
            return {
                'Status': 'SUCCESS',
                'PhysicalResourceId': event['PhysicalResourceId']
            }
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return {
            'Status': 'FAILED',
            'PhysicalResourceId': event.get('PhysicalResourceId', 'failed'),
            'Reason': str(e)
        }
`),
      timeout: cdk.Duration.minutes(10),
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
                  "qbusiness:StartDataSourceSyncJob",
                  "qbusiness:StopDataSourceSyncJob",
                ],
                resources: ["*"],
              }),
            ],
          }),
        },
      }),
    });

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
    });

    // Explicit dependencies
    dataSourcesCustomResource.node.addDependency(urlFilesDeployment);
    dataSourcesCustomResource.node.addDependency(qBusinessApp);
    dataSourcesCustomResource.node.addDependency(qBusinessIndex);
    qBusinessIndex.node.addDependency(qBusinessApp);

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
    });

    // Lambda Function
    const chatLambda = new lambda.Function(this, "ChatLambdaFunction", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "lambda_function.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda")),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        QBUSINESS_APPLICATION_ID: qBusinessApp.attrApplicationId,
        DEBUG: "false",
      },
      description: "Catholic Charities Q Business Chat Handler",
    });

    // API Gateway
    const api = new apigateway.RestApi(this, "ChatAPI", {
      restApiName: `${projectName}-api`,
      description: "Catholic Charities Chatbot API",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "X-Amz-Date", "Authorization", "X-Api-Key", "X-Amz-Security-Token"],
      },
    });

    // API Gateway Integration
    const lambdaIntegration = new apigateway.LambdaIntegration(chatLambda, {
      requestTemplates: { "application/json": '{ "statusCode": "200" }' },
    });

    // API Routes
    const chatResource = api.root.addResource("chat");
    chatResource.addMethod("POST", lambdaIntegration);

    const healthResource = api.root.addResource("health");
    healthResource.addMethod("GET", lambdaIntegration);

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
    });

    // Main branch
    const mainBranch = new amplify.CfnBranch(this, "MainBranch", {
      appId: amplifyApp.attrAppId,
      branchName: "main",
      enableAutoBuild: true,
      stage: "PRODUCTION",
    });

    // Outputs
    new cdk.CfnOutput(this, "QBusinessApplicationId", { value: qBusinessApp.attrApplicationId });
    new cdk.CfnOutput(this, "QBusinessIndexId", { value: qBusinessIndex.attrIndexId });
    new cdk.CfnOutput(this, "DataSourceId", { value: dataSourcesCustomResource.getAttString("DataSources") });
    new cdk.CfnOutput(this, "APIGatewayURL", { value: api.url });
    new cdk.CfnOutput(this, "ChatEndpoint", { value: `${api.url}chat` });
    new cdk.CfnOutput(this, "HealthEndpoint", { value: `${api.url}health` });
    new cdk.CfnOutput(this, "AmplifyAppId", { value: amplifyApp.attrAppId });
    new cdk.CfnOutput(this, "AmplifyAppURL", { value: `https://${mainBranch.branchName}.${amplifyApp.attrDefaultDomain}` });
    new cdk.CfnOutput(this, "S3Bucket", { value: dataBucket.bucketName });
    new cdk.CfnOutput(this, "IdentityCenterInstanceArn", { value: identityCenterInstanceArn });
  }
}