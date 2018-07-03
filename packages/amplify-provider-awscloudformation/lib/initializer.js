const aws = require('aws-sdk');
const moment = require('moment');
const path = require('path');
const fs = require('fs-extra');
const ora = require('ora');
const constants = require('./constants');
const configurationManager = require('./configuration-manager');

function run(context) {
  return configurationManager.init(context)
    .then(ctxt => new Promise((resolve, reject) => {
      const awscfn = getConfiguredAwsCfnClient(ctxt);
      const initTemplateFilePath = path.join(__dirname, 'rootStackTemplate.json');
      const timeStamp = `-${moment().format('YYYYMMDDHHmmss')}`;
      const stackName = ctxt.initInfo.projectName + timeStamp;
      const deploymentBucketName = `${stackName}-deployment`;
      const params = {
        StackName: stackName,
        TemplateBody: fs.readFileSync(initTemplateFilePath).toString(),
        Parameters: [
          {
            ParameterKey: 'DeploymentBucketName',
            ParameterValue: deploymentBucketName,
          },
        ],
      };

      const spinner = ora('Creating root stack');
      spinner.start();
      awscfn.createStack(params, (err) => {
        if (err) {
          spinner.fail('Root stack creation failed');
          return reject(err);
        }

        const waitParams = {
          StackName: stackName,
        };
        spinner.start('Initializing project in the cloud...');
        awscfn.waitFor('stackCreateComplete', waitParams, (waitErr, waitData) => {
          if (waitErr) {
            spinner.fail('Root stack creation failed');
            return reject(waitErr);
          }
          spinner.succeed('Successfully initialized project in the cloud.');
          processStackCreationData(ctxt, waitData);
          resolve(ctxt);
        });
      });
    }));
}

function getConfiguredAwsCfnClient(context) {
  const { projectConfigInfo } = context;
  process.env.AWS_SDK_LOAD_CONFIG = true;
  if (projectConfigInfo.action === 'init') {
    if (projectConfigInfo.useProfile && projectConfigInfo.profileName) {
      process.env.AWS_PROFILE = projectConfigInfo.profileName;
    } else {
      aws.config.update({
        accessKeyId: projectConfigInfo.accessKeyId,
        secretAccessKey: projectConfigInfo.secretAccessKey,
        region: projectConfigInfo.region,
      });
    }
  }
  return new aws.CloudFormation();
}

function processStackCreationData(context, stackDescriptiondata) {
  const metaData = {};
  const { Outputs } = stackDescriptiondata.Stacks[0];
  Outputs.forEach((element) => {
    metaData[element.OutputKey] = element.OutputValue;
  });

  if (!context.initInfo.metaData.providers) {
    context.initInfo.metaData.providers = {};
  }
  context.initInfo.metaData.providers[constants.ProviderName] = metaData;

  if (!context.initInfo.rcData.providers) {
    context.initInfo.rcData.providers = {};
  }
  context.initInfo.rcData.providers[constants.ProviderName] = metaData;
}

function onInitSuccessful(context) {
  return new Promise((resolve) => {
    configurationManager.onInitSuccessful(context);
    resolve(context);
  });
}

module.exports = {
  run,
  onInitSuccessful,
};
