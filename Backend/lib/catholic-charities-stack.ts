import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as amplify from "aws-cdk-lib/aws-amplify";
import * as qbusiness from "aws-cdk-lib/aws-qbusiness";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";
import { CustomResource, Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Provider } from "aws-cdk-lib/custom-resources";

export interface CatholicCharitiesStackProps extends cdk.StackProps {
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly githubToken: string;
  readonly projectName?: string;
  readonly urlFilesPath?: string; // Path to URL files in the repo
}

export class CatholicCharitiesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CatholicCharitiesStackProps) {
    super(scope, id, props);

    const projectName = props.projectName || "catholic-charities-chatbot";
    const urlFilesPath = props.urlFilesPath || "data-sources";

    // Lambda to retrieve IAM Identity Center ARN
    const ssoArnRetriever = new NodejsFunction(this, "SSOArnRetriever", {
      entry: require.resolve("./sso-arn-retriever.handler.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      handler: "handler",
      bundling: {
        externalModules: ["@aws-sdk/client-sso-admin"],
      },
    });

    // Grant sso:ListInstances permission
    ssoArnRetriever.role?.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sso:ListInstances"],
        resources: ["*"],
      })
    );

    // Custom resource provider
    const ssoArnProvider = new Provider(this, "SSOArnProvider", {
      onEventHandler: ssoArnRetriever,
    });

    // Custom resource to get ARN
    const ssoArnResource = new CustomResource(this, "SSOArnResource", {
      serviceToken: ssoArnProvider.serviceToken,
      properties: {
        Region: this.region,
      },
    });

    const identityCenterInstanceArn = ssoArnResource.getAttString("InstanceArn");
    if (!identityCenterInstanceArn) {
      throw new Error("Failed to retrieve IAM Identity Center ARN. Ensure organization instance is enabled and role has 'sso:ListInstances' permission.");
    }

    // S3 Bucket for data sources
    const dataBucket = new s3.Bucket(this, "DataSourceBucket", {
      bucketName: `${projectName}-data-sources-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Deploy URL files from the repository to S3
    const urlFilesDeployment = new s3deploy.BucketDeployment(this, "DeployUrlFiles", {
      sources: [s3deploy.Source.asset(urlFilesPath)],
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
        QBusinessPermissions: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "qbusiness:CreateApplication",
                "qbusiness:UpdateApplication",
                "qbusiness:DeleteApplication",
                "qbusiness:CreateIndex",
                "qbusiness:UpdateIndex",
                "qbusiness:DeleteIndex",
                "qbusiness:CreateDataSource",
                "qbusiness:UpdateDataSource",
                "qbusiness:DeleteDataSource",
                "qbusiness:StartDataSourceSyncJob",
                "qbusiness:StopDataSourceSyncJob",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["cloudwatch:PutMetricData"],
              resources: ["*"],
              conditions: {
                StringEquals: { "cloudwatch:namespace": "AWS/QBusiness" },
              },
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["logs:DescribeLogGroups", "logs:CreateLogGroup"],
              resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/qbusiness/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["logs:DescribeLogStreams", "logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/qbusiness/*:log-stream:*`],
            }),
          ],
        }),
        S3Access: new iam.PolicyDocument({
          statements: [
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
          ],
        }),
      },
    });

    // Q Business S3 Data Source
    const qBusinessDataSource = new qbusiness.CfnDataSource(this, "QBusinessDataSource", {
      applicationId: qBusinessApp.attrApplicationId,
      indexId: qBusinessIndex.attrIndexId,
      displayName: `${projectName}-s3-datasource`,
      description: "S3 data source for Catholic Charities .txt files",
      roleArn: dataSourceRole.roleArn,
      configuration: {
        type: "S3",
        connectionConfiguration: {
          repositoryEndpointMetadata: {
            bucketName: dataBucket.bucketName,
          },
        },
        syncMode: "FULL_CRAWL",
        syncSchedule: "ON_DEMAND",
        repositoryConfigurations: {
          document: {
            fieldMappings: [
              {
                indexFieldName: "_document_title",
                indexFieldType: "STRING",
                dataSourceFieldName: "title",
              },
              {
                indexFieldName: "_source_uri",
                indexFieldType: "STRING",
                dataSourceFieldName: "sourceUri",
              },
              {
                indexFieldName: "content",
                indexFieldType: "STRING",
                dataSourceFieldName: "content",
              },
            ],
          },
        },
      },
    });

    // Ensure data source depends on index and URL files deployment
    qBusinessDataSource.node.addDependency(qBusinessIndex);
    qBusinessDataSource.node.addDependency(urlFilesDeployment);

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
      code: lambda.Code.fromAsset("lambda"),
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
    new cdk.CfnOutput(this, "QBusinessApplicationId", {
      value: qBusinessApp.attrApplicationId,
      description: "Q Business Application ID",
    });

    new cdk.CfnOutput(this, "QBusinessIndexId", {
      value: qBusinessIndex.attrIndexId,
      description: "Q Business Index ID",
    });

    new cdk.CfnOutput(this, "DataSourceId", {
      value: qBusinessDataSource.ref,
      description: "Q Business Data Source ID",
    });

    new cdk.CfnOutput(this, "APIGatewayURL", {
      value: api.url,
      description: "API Gateway URL",
    });

    new cdk.CfnOutput(this, "ChatEndpoint", {
      value: `${api.url}chat`,
      description: "Chat API Endpoint",
    });

    new cdk.CfnOutput(this, "HealthEndpoint", {
      value: `${api.url}health`,
      description: "Health Check Endpoint",
    });

    new cdk.CfnOutput(this, "AmplifyAppId", {
      value: amplifyApp.attrAppId,
      description: "Amplify App ID",
    });

    new cdk.CfnOutput(this, "AmplifyAppURL", {
      value: `https://${mainBranch.branchName}.${amplifyApp.attrDefaultDomain}`,
      description: "Amplify App URL",
    });

    new cdk.CfnOutput(this, "S3BucketName", {
      value: dataBucket.bucketName,
      description: "S3 Data Source Bucket Name",
    });
  }
}