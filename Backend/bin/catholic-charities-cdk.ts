#!/usr/bin/env node
import "source-map-support/register"
import * as cdk from "aws-cdk-lib"
import { CatholicCharitiesStack } from "../lib/catholic-charities-stack"

const app = new cdk.App()

// Get parameters from context or environment variables
const githubOwner = app.node.tryGetContext("githubOwner") || process.env.GITHUB_OWNER 
const githubRepo = app.node.tryGetContext("githubRepo") || process.env.GITHUB_REPO
const projectName = app.node.tryGetContext("projectName") || process.env.PROJECT_NAME 
const urlFilesPath = app.node.tryGetContext("urlFilesPath") || process.env.URL_FILES_PATH 
const amplifyAppName = app.node.tryGetContext("amplifyAppName") || process.env.AMPLIFY_APP_NAME
const amplifyBranchName = app.node.tryGetContext("amplifyBranchName") || process.env.AMPLIFY_BRANCH_NAME

if (!githubOwner || !githubRepo) {
  throw new Error("GitHub owner and repo must be provided via context or environment variables")
}

new CatholicCharitiesStack(app, "CatholicCharitiesStack", {
  githubOwner,
  githubRepo,
  projectName,
  urlFilesPath,
  amplifyAppName,
  amplifyBranchName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
})
