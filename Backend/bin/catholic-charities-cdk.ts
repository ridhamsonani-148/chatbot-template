#!/usr/bin/env node
import "source-map-support/register"
import * as cdk from "aws-cdk-lib"
import { CatholicCharitiesStack } from "../lib/catholic-charities-stack"

const app = new cdk.App()

// Get parameters from context or environment variables
const githubOwner = app.node.tryGetContext("githubOwner") || process.env.GITHUB_OWNER || ""
const githubRepo = app.node.tryGetContext("githubRepo") || process.env.GITHUB_REPO || ""
const githubToken = app.node.tryGetContext("githubToken") || process.env.GITHUB_TOKEN || ""
const projectName = app.node.tryGetContext("projectName") || process.env.PROJECT_NAME || "catholic-charities-chatbot"
const urlFilesPath = app.node.tryGetContext("urlFilesPath") || process.env.URL_FILES_PATH || "data-sources"

// Default data source URLs for Catholic Charities
const defaultUrls = [
  "https://www.catholiccharitiesusa.org/",
  "https://www.catholiccharitiesusa.org/our-ministry/",
  "https://www.catholiccharitiesusa.org/find-help/",
  "https://www.catholiccharitiesusa.org/ways-to-give/",
]

const dataSourceUrls =
  app.node.tryGetContext("dataSourceUrls") ||
  (process.env.DATA_SOURCE_URLS ? process.env.DATA_SOURCE_URLS.split(",") : defaultUrls)

if (!githubOwner || !githubRepo || !githubToken) {
  throw new Error("GitHub owner, repo, and token must be provided via context or environment variables")
}

new CatholicCharitiesStack(app, "CatholicCharitiesStack", {
  githubOwner,
  githubRepo,
  githubToken,
  projectName,
  urlFilesPath,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
})
