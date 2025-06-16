#!/usr/bin/env node
import "source-map-support/register"
import * as cdk from "aws-cdk-lib"
import { CatholicCharitiesStack3 } from "../lib/catholic-charities-stack"

const app = new cdk.App()

// Get parameters from context or environment variables
const githubOwner = app.node.tryGetContext("githubOwner") || process.env.GITHUB_OWNER || ""
const githubRepo = app.node.tryGetContext("githubRepo") || process.env.GITHUB_REPO || ""
const githubToken = app.node.tryGetContext("githubToken") || process.env.GITHUB_TOKEN || ""
const projectName = app.node.tryGetContext("projectName") || process.env.PROJECT_NAME || "catholic-charities-chatbot"
const urlFilesPath = app.node.tryGetContext("urlFilesPath") || process.env.URL_FILES_PATH || "data-sources"

// Optional: Organization Identity Center ARN (if account doesn't have Identity Center enabled)
const identityCenterInstanceArn =
  app.node.tryGetContext("identityCenterInstanceArn") || process.env.IDENTITY_CENTER_INSTANCE_ARN

if (!githubOwner || !githubRepo || !githubToken) {
  throw new Error("GitHub owner, repo, and token must be provided via context or environment variables")
}

new CatholicCharitiesStack3(app, "CatholicCharitiesStack3", {
  githubOwner,
  githubRepo,
  githubToken,
  projectName,
  urlFilesPath,
  identityCenterInstanceArn, // This can be undefined if not provided
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ,
  },
})
