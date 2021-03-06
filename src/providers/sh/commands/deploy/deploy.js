//@flow

// Native
const { resolve, basename } = require('path')

// Packages
const { eraseLines } = require('ansi-escapes')
const { write: copy } = require('clipboardy')
const bytes = require('bytes')
const chalk = require('chalk')
const dotenv = require('dotenv')
const fs = require('fs-extra')
const inquirer = require('inquirer')
const mri = require('mri')
const ms = require('ms')
const plural = require('pluralize')
const Progress = require('progress')

// Utilities
const { handleError } = require('../../util/error')
const { tick } = require('../../../../util/output/chars')
const checkPath = require('../../util/check-path')
const cmd = require('../../../../util/output/cmd')
const createOutput = require('../../../../util/output')
const exit = require('../../../../util/exit')
const logo = require('../../../../util/output/logo')
const Now = require('../../util')
const uniq = require('../../util/unique-strings')
const promptBool = require('../../../../util/input/prompt-bool')
const promptOptions = require('../../util/prompt-options')
const readMetaData = require('../../util/read-metadata')
const toHumanPath = require('../../../../util/humanize-path')

import { Output } from '../../util/types'
import * as Errors from '../../util/errors'
import combineAsyncGenerators from '../../../../util/combine-async-generators'
import createDeploy from '../../util/deploy/create-deploy'
import dnsTable from '../../util/dns-table'
import eventListenerToGenerator from '../../../../util/event-listener-to-generator'
import formatLogCmd from '../../../../util/output/format-log-cmd'
import formatLogOutput from '../../../../util/output/format-log-output'
import getContextName from '../../util/get-context-name'
import getEventsStream from '../../util/deploy/get-events-stream'
import getInstanceIndex from '../../util/deploy/get-instance-index'
import getStateChangeFromPolling from '../../util/deploy/get-state-change-from-polling'
import joinWords from '../../../../util/output/join-words';
import normalizeRegionsList from '../../util/scale/normalize-regions-list'
import raceAsyncGenerators from '../../../../util/race-async-generators'
import regionOrDCToDc from '../../util/scale/region-or-dc-to-dc'
import stamp from '../../../../util/output/stamp'
import verifyDeploymentScale from '../../util/scale/verify-deployment-scale'
import zeitWorldTable from '../../util/zeit-world-table'
import type { Readable } from 'stream'
import type { NewDeployment, DeploymentEvent } from '../../util/types'
import type { CreateDeployError } from '../../util/deploy/create-deploy'

const mriOpts = {
  string: ['name', 'alias', 'session-affinity', 'regions'],
  boolean: [
    'help',
    'version',
    'debug',
    'force',
    'links',
    'C',
    'clipboard',
    'forward-npm',
    'docker',
    'npm',
    'static',
    'public'
  ],
  default: {
    C: false,
    clipboard: true,
  },
  alias: {
    env: 'e',
    'build-env': 'b',
    dotenv: 'E',
    help: 'h',
    debug: 'd',
    version: 'v',
    force: 'f',
    links: 'l',
    public: 'p',
    'forward-npm': 'N',
    'session-affinity': 'S',
    name: 'n',
    alias: 'a'
  }
}

const help = () => {
  console.log(`
  ${chalk.bold(`${logo} now`)} [options] <command | path>

  ${chalk.dim('Commands:')}

    ${chalk.dim('Cloud')}

      deploy               [path]      Performs a deployment ${chalk.bold('(default)')}
      ls | list            [app]       Lists deployments
      rm | remove          [id]        Removes a deployment
      ln | alias           [id] [url]  Configures aliases for deployments
      inspect              [id]        Displays information related to a deployment
      domains              [name]      Manages your domain names
      certs                [cmd]       Manages your SSL certificates
      secrets              [name]      Manages your secret environment variables
      dns                  [name]      Manages your DNS records
      logs                 [url]       Displays the logs for a deployment
      scale                [args]      Scales the instance count of a deployment
      help                 [cmd]       Displays complete help for [cmd]

    ${chalk.dim('Administrative')}

      billing | cc         [cmd]       Manages your credit cards and billing methods
      upgrade | downgrade  [plan]      Upgrades or downgrades your plan
      teams                [team]      Manages your teams
      switch                           Switches between teams and your account
      login                            Logs into your account or creates a new one
      logout                           Logs out of your account
      whoami                           Displays the currently logged in username

  ${chalk.dim('Options:')}

    -h, --help                     Output usage information
    -v, --version                  Output the version number
    -n, --name                     Set the name of the deployment
    -A ${chalk.bold.underline('FILE')}, --local-config=${chalk.bold.underline(
    'FILE'
  )}   Path to the local ${'`now.json`'} file
    -Q ${chalk.bold.underline('DIR')}, --global-config=${chalk.bold.underline(
    'DIR'
  )}    Path to the global ${'`.now`'} directory
    -d, --debug                    Debug mode [off]
    -f, --force                    Force a new deployment even if nothing has changed
    -t ${chalk.underline('TOKEN')}, --token=${chalk.underline(
    'TOKEN'
  )}        Login token
    -l, --links                    Copy symlinks without resolving their target
    -p, --public                   Deployment is public (${chalk.dim(
      '`/_src`'
    )} is exposed) [on for oss, off for premium]
    -e, --env                      Include an env var during run time (e.g.: ${chalk.dim(
      '`-e KEY=value`'
    )}). Can appear many times.
    -b, --build-env                Similar to ${chalk.dim('`--env`')} but for build time only.
    -E ${chalk.underline('FILE')}, --dotenv=${chalk.underline(
    'FILE'
  )}         Include env vars from .env file. Defaults to '.env'
    -C, --no-clipboard             Do not attempt to copy URL to clipboard
    -N, --forward-npm              Forward login information to install private npm modules
    --session-affinity             Session affinity, \`ip\` or \`random\` (default) to control session affinity
    -T, --team                     Set a custom team scope
    --regions                      Set default regions or DCs to enable the deployment on
    --no-verify                    Skip step of waiting until instance count meets given constraints

  ${chalk.dim(`Enforceable Types (by default, it's detected automatically):`)}

    --npm                          Node.js application
    --docker                       Docker container
    --static                       Static file hosting

  ${chalk.dim('Examples:')}

  ${chalk.gray('–')} Deploy the current directory

    ${chalk.cyan('$ now')}

  ${chalk.gray('–')} Deploy a custom path

    ${chalk.cyan('$ now /usr/src/project')}

  ${chalk.gray('–')} Deploy a GitHub repository

    ${chalk.cyan('$ now user/repo#ref')}

  ${chalk.gray('–')} Deploy with environment variables

    ${chalk.cyan('$ now -e NODE_ENV=production -e SECRET=@mysql-secret')}

  ${chalk.gray('–')} Show the usage information for the sub command ${chalk.dim(
    '`list`'
  )}

    ${chalk.cyan('$ now help list')}
`)
}

let argv
let paths

// Options
let forceNew
let deploymentName
let sessionAffinity
let log
let error
let warn
let debug
let note
let debugEnabled
let clipboard
let forwardNpm
let followSymlinks
let wantsPublic
let regions
let noVerify
let apiUrl
let isTTY
let quiet
let alwaysForwardNpm

// If the current deployment is a repo
const gitRepo = {}

// For `env` and `buildEnv`
const getNullFields = o => Object.keys(o).filter(k => o[k] === null)

const addProcessEnv = async (env) => {
  let val
  for (const key of Object.keys(env)) {
    if (typeof env[key] !== 'undefined') continue
    val = process.env[key]
    if (typeof val === 'string') {
      log(
        `Reading ${chalk.bold(
          `"${chalk.bold(key)}"`
        )} from your env (as no value was specified)`
      )
      // Escape value if it begins with @
      env[key] = val.replace(/^@/, '\\@')
    } else {
      error(
        `No value specified for env ${chalk.bold(
          `"${chalk.bold(key)}"`
        )} and it was not found in your env.`
      )
      await exit(1)
      return
    }
  }
}

const stopDeployment = async msg => {
  handleError(msg)
  await exit(1)
}

// Converts `env` Arrays, Strings and Objects into env Objects.
// `null` empty value means to prompt user for value upon deployment.
// `undefined` empty value means to inherit value from user's env.
const parseEnv = (env, empty) => {
  if (!env) {
    return {}
  }
  if (typeof env === 'string') {
    // a single `--env` arg comes in as a String
    env = [env]
  }
  if (Array.isArray(env)) {
    return env.reduce((o, e) => {
      let key
      let value
      const equalsSign = e.indexOf('=')
      if (equalsSign === -1) {
        key = e
        value = empty
      } else {
        key = e.substr(0, equalsSign)
        value = e.substr(equalsSign + 1)
      }
      o[key] = value
      return o
    }, {})
  }
  // assume it's already an Object
  return env
}

const promptForEnvFields = async list => {
  if (list.length === 0) {
    return {}
  }

  const questions = []

  for (const field of list) {
    questions.push({
      name: field,
      message: field
    })
  }

  // eslint-disable-next-line import/no-unassigned-import
  require('../../../../util/input/patch-inquirer')

  log('Please enter values for the following environment variables:')
  const answers = await inquirer.prompt(questions)

  for (const answer of Object.keys(answers)) {
    const content = answers[answer]

    if (content === '') {
      await stopDeployment(`Enter a value for ${answer}`)
    }
  }

  return answers
}

async function main(ctx: any) {
  argv = mri(ctx.argv.slice(2), mriOpts)

  // very ugly hack – this (now-cli's code) expects that `argv._[0]` is the path
  // we should fix this ASAP
  if (argv._[0] === 'sh') {
    argv._.shift()
  }

  if (argv._[0] === 'deploy') {
    argv._.shift()
  }

  if (argv._.length > 0) {
    // If path is relative: resolve
    // if path is absolute: clear up strange `/` etc
    paths = argv._.map(item => resolve(process.cwd(), item))
  } else {
    paths = [process.cwd()]
  }

  // Options
  forceNew = argv.force
  deploymentName = argv.name
  sessionAffinity = argv['session-affinity']
  debugEnabled = argv.debug
  clipboard = argv.clipboard && !argv.C
  forwardNpm = argv['forward-npm']
  followSymlinks = !argv.links
  wantsPublic = argv.public
  regions = (argv.regions || '').split(',').map(s => s.trim()).filter(Boolean)
  noVerify = argv['verify'] === false
  apiUrl = ctx.apiUrl
  const output = createOutput({ debug: debugEnabled })
  // https://github.com/facebook/flow/issues/1825
  // $FlowFixMe
  isTTY = process.stdout.isTTY
  quiet = !isTTY
  ;({ log, error, note, debug, warn } = output)

  if (argv.h || argv.help) {
    help()
    await exit(0)
  }

  const { authConfig: { credentials }, config: { sh } } = ctx
  const { token } = credentials.find(item => item.provider === 'sh')
  const contextName = getContextName(sh);
  const config = sh

  alwaysForwardNpm = config.forwardNpm

  try {
    return sync({ contextName, output, token, config, firstRun: true, deploymentType: undefined })
  } catch (err) {
    await stopDeployment(err)
  }
}

async function sync({ contextName, output, token, config: { currentTeam, user }, firstRun, deploymentType }) {
  return new Promise(async (_resolve, reject) => {
    let deployStamp = stamp()
    const rawPath = argv._[0]

    let meta
    let deployment: NewDeployment | null = null
    let isFile

    if (paths.length === 1) {
      try {
        const fsData = await fs.lstat(paths[0])

        if (fsData.isFile()) {
          isFile = true
          deploymentType = 'static'
        }
      } catch (err) {
        let repo
        let isValidRepo = false

        const { fromGit, isRepoPath, gitPathParts } = require('../../util/git')

        try {
          isValidRepo = isRepoPath(rawPath)
        } catch (_err) {
          if (err.code === 'INVALID_URL') {
            await stopDeployment(_err)
          } else {
            reject(_err)
          }
        }

        if (isValidRepo) {
          const gitParts = gitPathParts(rawPath)
          Object.assign(gitRepo, gitParts)

          const searchMessage = setTimeout(() => {
            log(`Didn't find directory. Searching on ${gitRepo.type}...`)
          }, 500)

          try {
            repo = await fromGit(rawPath, debugEnabled)
          } catch (err) {}

          clearTimeout(searchMessage)
        }

        if (repo) {
          // Tell now which directory to deploy
          paths = [ repo.path ]

          // Set global variable for deleting tmp dir later
          // once the deployment has finished
          Object.assign(gitRepo, repo)
        } else if (isValidRepo) {
          const gitRef = gitRepo.ref ? `with "${chalk.bold(gitRepo.ref)}" ` : ''

          await stopDeployment(`There's no repository named "${chalk.bold(
              gitRepo.main
            )}" ${gitRef}on ${gitRepo.type}`)
        } else {
          error(`The specified directory "${basename(paths[0])}" doesn't exist.`)
          await exit(1)
        }
      }
    } else {
      isFile = false
      deploymentType = 'static'
    }

    const checkers = []

    if (isFile || (!isFile && paths.length === 1)) {
      checkers.push(checkPath(paths[0]))
    } else {
      for (const path of paths) {
        const fsData = await fs.lstat(path)

        if (fsData.isFile()) {
          continue
        }

        checkers.push(checkPath(path))
      }
    }

    try {
      await Promise.all(checkers)
    } catch (err) {
      error(err.message, 'path-not-deployable')
      await exit(1)
    }

    if (!quiet && firstRun) {
      if (gitRepo.main) {
        const gitRef = gitRepo.ref ? ` at "${chalk.bold(gitRepo.ref)}" ` : ''

        log(`Deploying ${gitRepo.type} repository "${chalk.bold(
            gitRepo.main
          )}"${gitRef} under ${chalk.bold(
            (currentTeam && currentTeam.slug) || user.username || user.email
          )}`)
      } else {
        const list = paths
          .map((path, index) => {
            let suffix = ''

            if (paths.length > 1 && index !== paths.length - 1) {
              suffix = index < paths.length - 2 ? ', ' : ' and '
            }

            return chalk.bold(toHumanPath(path)) + suffix
          })
          .join('')

        log(`Deploying ${list} under ${chalk.bold(
            (currentTeam && currentTeam.slug) || user.username || user.email
          )}`)
      }
    }

    if (!isFile && deploymentType !== 'static') {
      if (argv.docker) {
        debug(`Forcing \`deploymentType\` = \`docker\``)
        deploymentType = 'docker'
      } else if (argv.npm) {
        debug(`Forcing \`deploymentType\` = \`npm\``)
        deploymentType = 'npm'
      } else if (argv.static) {
        debug(`Forcing \`deploymentType\` = \`static\``)
        deploymentType = 'static'
      }
    } else if (deploymentType === 'static') {
      debug(`Forcing \`deploymentType\` = \`static\` automatically`)

      meta = {
        name: deploymentName || (isFile
          ? 'file'
          : paths.length === 1 ? basename(paths[0]) : 'files'),
        type: deploymentType,
        pkg: undefined,
        nowConfig: undefined,
        hasNowJson: false,

        // XXX: legacy
        deploymentType,
        sessionAffinity
      }
    }

    if (!meta) {
      ;({
        meta,
        deploymentName,
        deploymentType,
        sessionAffinity
      } = await readMeta(paths[0], deploymentName, deploymentType, sessionAffinity))
    }

    const nowConfig = meta.nowConfig || {}
    const scaleFromConfig = getScaleFromConfig(nowConfig)
    let scale = {}
    let dcIds

    // If there are regions coming from the args and now.json warn about it
    if (regions.length > 0 && getRegionsFromConfig(nowConfig).length > 0) {
      warn(`You have regions defined from both args and now.json, using ${chalk.bold(regions.join(','))}`)
    }

    // If there are no regions from args, use config
    if (regions.length === 0) {
      regions = getRegionsFromConfig(nowConfig)
    }

    // Read scale and fail if we have both regions and scale
    if (regions.length > 0 && Object.keys(scaleFromConfig).length > 0) {
      error("Can't set both `regions` and `scale` options simultaneously", 'regions-and-scale-at-once')
      await exit(1)
    }

    // If we have a regions list we use it to build scale presets
    if (regions.length > 0) {
      dcIds = normalizeRegionsList(regions)
      if (dcIds instanceof Errors.InvalidRegionOrDCForScale) {
        error(`The value "${dcIds.meta.regionOrDC}" is not a valid region or DC identifier`)
        await exit(1)
        return 1
      } else if (dcIds instanceof Errors.InvalidAllForScale) {
        error(`You can't use all in the regions list mixed with other regions`)
        await exit(1)
        return 1
      }

      // Build the scale presets based on the given regions
      scale = dcIds.reduce((result, dcId) => ({ ...result, [dcId]: {min: 0, max: 1}}), {})
    } else if (Object.keys(scaleFromConfig).length > 0) {
      // If we have no regions list we get it from the scale keys but we have to validate
      // them becase we don't admin `all` in this scenario. Also normalize presets in scale.
      for (const regionOrDc of Object.keys(scaleFromConfig)) {
        const dc = regionOrDCToDc(regionOrDc)
        if (dc === undefined) {
          error(`The value "${regionOrDc}" in \`scale\` settings is not a valid region or DC identifier`, 'deploy-invalid-dc')
          await exit(1)
          return 1
        } else {
          scale[dc] = scaleFromConfig[regionOrDc]
        }
      }
    }

    debug(`Scale presets for deploy: ${JSON.stringify(scale)}`)
    const now = new Now({ apiUrl, token, debug: debugEnabled, currentTeam })

    let dotenvConfig
    let dotenvOption

    if (argv.dotenv) {
      dotenvOption = argv.dotenv
    } else if (nowConfig.dotenv) {
      dotenvOption = nowConfig.dotenv
    }

    if (dotenvOption) {
      const dotenvFileName =
        typeof dotenvOption === 'string' ? dotenvOption : '.env'

      try {
        const dotenvFile = await fs.readFile(dotenvFileName)
        dotenvConfig = dotenv.parse(dotenvFile)
      } catch (err) {
        if (err.code === 'ENOENT') {
          error(
            `--dotenv flag is set but ${dotenvFileName} file is missing`,
            'missing-dotenv-target'
          )

          await exit(1)
        } else {
          throw err
        }
      }
    }

    // Merge dotenv config, `env` from now.json, and `--env` / `-e` arguments
    const deploymentEnv = Object.assign(
      {},
      dotenvConfig,
      parseEnv(nowConfig.env, null),
      parseEnv(argv.env, undefined)
    )

    // Merge build env out of  `build.env` from now.json, and `--build-env` args
    const deploymentBuildEnv = Object.assign(
      {},
      parseEnv(nowConfig.build && nowConfig.build.env, null),
      parseEnv(argv['build-env'], undefined)
    )

    // If there's any envs with `null` then prompt the user for the values
    const envNullFields = getNullFields(deploymentEnv)
    const buildEnvNullFields = getNullFields(deploymentBuildEnv)
    const userEnv = await promptForEnvFields(uniq([
      ...envNullFields,
      ...buildEnvNullFields
    ]).sort())
    for (const key of envNullFields) {
      deploymentEnv[key] = userEnv[key]
    }
    for (const key of buildEnvNullFields) {
      deploymentBuildEnv[key] = userEnv[key]
    }

    // If there's any undefined values, then inherit them from this process
    await addProcessEnv(deploymentEnv)
    await addProcessEnv(deploymentBuildEnv)

    // Put the `build.env` back onto the `nowConfig`
    if (Object.keys(deploymentBuildEnv).length > 0) {
      if (!nowConfig.build) nowConfig.build = {};
      nowConfig.build.env = deploymentBuildEnv;
    }

    let secrets
    const findSecret = async uidOrName => {
      if (!secrets) {
        secrets = await now.listSecrets()
      }

      return secrets.filter(secret => {
        return secret.name === uidOrName || secret.uid === uidOrName
      })
    }

    const env_ = await Promise.all(
      Object.keys(deploymentEnv).map(async key => {
        if (!key) {
          error(
            'Environment variable name is missing',
            'missing-env-key-value'
          )

          await exit(1)
        }

        if (/[^A-z0-9_]/i.test(key)) {
          error(
            `Invalid ${chalk.dim('-e')} key ${chalk.bold(
              `"${chalk.bold(key)}"`
            )}. Only letters, digits and underscores are allowed.`
          )

          await exit(1)
        }

        let val = deploymentEnv[key]

        if (val[0] === '@') {
          const uidOrName = val.substr(1)
          const _secrets = await findSecret(uidOrName)

          if (_secrets.length === 0) {
            if (uidOrName === '') {
              error(
                `Empty reference provided for env key ${chalk.bold(
                  `"${chalk.bold(key)}"`
                )}`
              )
            } else {
              error(
                `No secret found by uid or name ${chalk.bold(`"${uidOrName}"`)}`,
                'env-no-secret'
              )
            }

            await exit(1)
          } else if (_secrets.length > 1) {
            error(
              `Ambiguous secret ${chalk.bold(
                `"${uidOrName}"`
              )} (matches ${chalk.bold(_secrets.length)} secrets)`
            )

            await exit(1)
          }

          val = { uid: _secrets[0].uid }
        }

        return [key, typeof val === 'string' ? val.replace(/^\\@/, '@') : val]
      })
    )

    const env = {}

    env_.filter(v => Boolean(v)).forEach(([key, val]) => {
      if (key in env) {
          note(`Overriding duplicate env key ${chalk.bold(`"${key}"`)}`)
      }

      env[key] = val
    })

    let syncCount

    try {
      // $FlowFixMe
      const createArgs = Object.assign(
        {
          env,
          followSymlinks,
          forceNew,
          forwardNpm: alwaysForwardNpm || forwardNpm,
          quiet,
          scale,
          wantsPublic,
          sessionAffinity,
          isFile
        },
        meta
      )

      deployStamp = stamp()
      const firstDeployCall = await createDeploy(output, now, contextName, paths, createArgs)
      if (
        (firstDeployCall instanceof Errors.CantSolveChallenge) ||
        (firstDeployCall instanceof Errors.CantGenerateWildcardCert) ||
        (firstDeployCall instanceof Errors.DomainConfigurationError) ||
        (firstDeployCall instanceof Errors.DomainNameserversNotFound) ||
        (firstDeployCall instanceof Errors.DomainNotFound) ||
        (firstDeployCall instanceof Errors.DomainNotVerified) ||
        (firstDeployCall instanceof Errors.DomainPermissionDenied) ||
        (firstDeployCall instanceof Errors.DomainsShouldShareRoot) ||
        (firstDeployCall instanceof Errors.DomainValidationRunning) ||
        (firstDeployCall instanceof Errors.DomainVerificationFailed) ||
        (firstDeployCall instanceof Errors.InvalidWildcardDomain) ||
        (firstDeployCall instanceof Errors.CDNNeedsUpgrade) ||
        (firstDeployCall instanceof Errors.TooManyCertificates) ||
        (firstDeployCall instanceof Errors.TooManyRequests)
      ) {
        handleCreateDeployError(output, firstDeployCall)
        await exit(1)
        return
      }

      deployment = firstDeployCall

      if (now.syncFileCount > 0) {
        const uploadStamp = stamp();
        await new Promise((resolve) => {
          if (now.syncFileCount !== now.fileCount) {
            debug(`Total files ${now.fileCount}, ${now.syncFileCount} changed`)
          }

          const size = bytes(now.syncAmount)
          syncCount = `${now.syncFileCount} file${now.syncFileCount > 1
            ? 's'
            : ''}`
          const bar = new Progress(
            `${chalk.gray('>')} Upload [:bar] :percent :etas (${size}) [${syncCount}]`,
            {
              width: 20,
              complete: '=',
              incomplete: '',
              total: now.syncAmount,
              clear: true
            }
          )

          now.upload({ scale })

          now.on('upload', ({ names, data }) => {
            debug(`Uploaded: ${names.join(' ')} (${bytes(data.length)})`)
          })

          now.on('uploadProgress', progress => {
            bar.tick(progress);
          })

          now.on('complete', resolve)

          now.on('error', err => {
            error('Upload failed')
            reject(err)
          })
        })

        if (!quiet && syncCount) {
          log(`Synced ${syncCount} (${bytes(now.syncAmount)}) ${uploadStamp()}`)
        }

        for (let i = 0; i < 4; i += 1) {
          deployStamp = stamp()
          const secondDeployCall = await createDeploy(output, now, contextName, paths, createArgs)
          if (
            (secondDeployCall instanceof Errors.CantSolveChallenge) ||
            (secondDeployCall instanceof Errors.CantGenerateWildcardCert) ||
            (secondDeployCall instanceof Errors.DomainConfigurationError) ||
            (secondDeployCall instanceof Errors.DomainNameserversNotFound) ||
            (secondDeployCall instanceof Errors.DomainNotFound) ||
            (secondDeployCall instanceof Errors.DomainNotVerified) ||
            (secondDeployCall instanceof Errors.DomainPermissionDenied) ||
            (secondDeployCall instanceof Errors.DomainsShouldShareRoot) ||
            (secondDeployCall instanceof Errors.DomainValidationRunning) ||
            (secondDeployCall instanceof Errors.DomainVerificationFailed) ||
            (secondDeployCall instanceof Errors.InvalidWildcardDomain) ||
            (secondDeployCall instanceof Errors.CDNNeedsUpgrade) ||
            (secondDeployCall instanceof Errors.TooManyCertificates) ||
            (secondDeployCall instanceof Errors.TooManyRequests)
          ) {
            handleCreateDeployError(output, secondDeployCall)
            await exit(1)
            return
          }

          if (now.syncFileCount === 0) {
            deployment = secondDeployCall
            break;
          }
        }

        if (deployment === null) {
          error('Uploading failed. Please try again.')
          await exit(1)
          return
        }
      }
    } catch (err) {
      if (err.code === 'plan_requires_public') {
        if (!wantsPublic) {
          const who = currentTeam ? 'your team is' : 'you are'

          let proceed
          log(`Your deployment's code and logs will be publicly accessible because ${who} subscribed to the OSS plan.`)

          if (isTTY) {
            proceed = await promptBool('Are you sure you want to proceed?', {
              trailing: eraseLines(1)
            })
          }

          let url = 'https://zeit.co/account/plan'

          if (currentTeam) {
            url = `https://zeit.co/teams/${currentTeam.slug}/settings/plan`
          }

          note(`You can use ${cmd('now --public')} or upgrade your plan (${url}) to skip this prompt`)

          if (!proceed) {
            if (typeof proceed === 'undefined') {
              const message = `If you agree with that, please run again with ${cmd('--public')}.`
              error(message)

              await exit(1)
            } else {
              log('Aborted')
              await exit(0)
            }

            return
          }
        }

        wantsPublic = true

        sync({
          contextName,
          output,
          token,
          config: {
            currentTeam,
            user
          },
          firstRun: false,
          deploymentType
        })

        return
      }

      debug(`Error: ${err}\n${err.stack}`)

      if (err.keyword === 'additionalProperties' && err.dataPath === '.scale') {
        const { additionalProperty = '' } = err.params || {}
        const message = regions.length
          ? `Invalid regions: ${additionalProperty.slice(0, -1)}`
          : `Invalid DC name for the scale option: ${additionalProperty}`
        error(message)
        await exit(1)
      }

      await stopDeployment(err)
      return 1;
    }

    const { url } = now
    const dcs = (deploymentType !== 'static' && deployment.scale)
      ? ` (${chalk.bold(Object.keys(deployment.scale).join(', '))})`
      : ''

    if (isTTY) {
      if (clipboard) {
        try {
          await copy(url)
          log(`${chalk.bold(chalk.cyan(url))} [in clipboard]${dcs} ${deployStamp()}`)
        } catch (err) {
          debug(`Error copying to clipboard: ${err}`)
          log(`${chalk.bold(chalk.cyan(url))} [in clipboard]${dcs} ${deployStamp()}`)
        }
      } else {
        log(`${chalk.bold(chalk.cyan(url))}${dcs} ${deployStamp()}`)
      }
    } else {
      process.stdout.write(url)
    }

    if (deploymentType === 'static') {
      if (deployment.readyState === 'INITIALIZING') {
        // This static deployment requires a build, so show the logs
        noVerify = true
      } else {
        if (!quiet) {
          output.log(chalk`{cyan Deployment complete!}`)
        }
        await exit(0)
        return
      }
    }

    // Show build logs
    // (We have to add this check for flow but it will never happen)
    if (deployment !== null) {

      // If the created deployment is ready it was a deduping and we should exit
      if (deployment.readyState !== 'READY') {
        require('assert')(deployment) // mute linter
        const instanceIndex = getInstanceIndex()
        const eventsStream = await maybeGetEventsStream(now, deployment)
        const eventsGenerator = getEventsGenerator(now, contextName, deployment, eventsStream)

        for await (const event of eventsGenerator) {
          // Stop when the deployment is ready
          if (event.type === 'state-change' && event.payload.value === 'READY') {
            output.log(`Build completed`);
            break
          }

          // Stop then there is an error state
          if (event.type === 'state-change' && event.payload.value === 'ERROR') {
            output.error(`Build failed`);
            await exit(1)
          }

          // For any relevant event we receive, print the result
          if (event.type === 'build-start') {
            output.log('Building…')
          } else if (event.type === 'command') {
            output.log(formatLogCmd(event.payload.text))
          } else if (event.type === 'stdout' || event.type === 'stderr') {
            formatLogOutput(event.payload.text).forEach(msg => output.log(msg))
          }
        }

        if (!noVerify) {
          output.log(`Verifying instantiation in ${joinWords(Object.keys(deployment.scale).map(dc => chalk.bold(dc)))}`)
          const verifyStamp = stamp()
          const verifyDCsGenerator = getVerifyDCsGenerator(output, now, deployment, eventsStream)

          for await (const dcOrEvent of verifyDCsGenerator) {
            if (dcOrEvent instanceof Errors.VerifyScaleTimeout) {
              output.error(`Instance verification timed out (${ms(dcOrEvent.meta.timeout)})`)
              output.log('Read more: https://err.sh/now-cli/verification-timeout')
              await exit(1)
            } else if (Array.isArray(dcOrEvent)) {
              const [dc, instances] = dcOrEvent
              output.log(`${chalk.cyan(tick)} Scaled ${plural('instance', instances, true)} in ${chalk.bold(dc)} ${verifyStamp()}`)
            } else if (dcOrEvent && (dcOrEvent.type === 'stdout' || dcOrEvent.type === 'stderr')) {
              const prefix = chalk.gray(`[${instanceIndex(dcOrEvent.payload.instanceId)}] `)
              formatLogOutput(dcOrEvent.payload.text, prefix).forEach(msg => output.log(msg))
            }
          }
        }
      }

      output.success(`Deployment ready`)
      await exit(0)
    }
  })
}

async function readMeta(
  _path,
  _deploymentName,
  deploymentType,
  _sessionAffinity
) {
  try {
    const meta = await readMetaData(_path, {
      deploymentType,
      deploymentName: _deploymentName,
      quiet: true,
      sessionAffinity: _sessionAffinity
    })

    if (!deploymentType) {
      deploymentType = meta.type
      debug(`Detected \`deploymentType\` = \`${deploymentType}\``)
    }

    if (!_deploymentName) {
      _deploymentName = meta.name
      debug(`Detected \`deploymentName\` = "${_deploymentName}"`)
    }

    return {
      meta,
      deploymentName: _deploymentName,
      deploymentType,
      sessionAffinity: _sessionAffinity
    }
  } catch (err) {
    if (isTTY && err.code === 'MULTIPLE_MANIFESTS') {
      debug('Multiple manifests found, disambiguating')
      log(
        `Two manifests found. Press [${chalk.bold(
          'n'
        )}] to deploy or re-run with --flag`
      )

      deploymentType = await promptOptions([
        ['npm', `${chalk.bold('package.json')}\t${chalk.gray('   --npm')} `],
        ['docker', `${chalk.bold('Dockerfile')}\t${chalk.gray('--docker')} `]
      ])

      debug(`Selected \`deploymentType\` = "${deploymentType}"`)
      return readMeta(_path, _deploymentName, deploymentType)
    }
    throw err
  }
}

function getRegionsFromConfig(config = {}): Array<string> {
  return config.regions || []
}

function getScaleFromConfig(config = {}): Object {
  return config.scale || {}
}

async function maybeGetEventsStream(now: Now, deployment: NewDeployment) {
  try {
    return await getEventsStream(now, deployment.deploymentId, { direction: 'forward', follow: true })
  } catch (error) {
    return null
  }
}

function getEventsGenerator(now: Now, contextName: string, deployment: NewDeployment, eventsStream: null | Readable): AsyncGenerator<DeploymentEvent, void, void> {
  const stateChangeFromPollingGenerator = getStateChangeFromPolling(now, contextName, deployment.deploymentId, deployment.readyState)
  if (eventsStream !== null) {
    return combineAsyncGenerators(
      eventListenerToGenerator('data', eventsStream),
      stateChangeFromPollingGenerator
    );
  }

  return stateChangeFromPollingGenerator
}

function getVerifyDCsGenerator(output: Output, now: Now, deployment: NewDeployment, eventsStream: Readable | null) {
  const verifyDeployment = verifyDeploymentScale(output, now, deployment.deploymentId, deployment.scale)

  return eventsStream
    ? raceAsyncGenerators(eventListenerToGenerator('data', eventsStream), verifyDeployment)
    : verifyDeployment
}

function handleCreateDeployError<OtherError>(output: Output, error: CreateDeployError | OtherError): 1 | OtherError {
  if (error instanceof Errors.CantGenerateWildcardCert) {
    output.error(`Custom suffixes are only allowed for domains in ${chalk.underline('zeit.world')}`)
    return 1
  } else if (error instanceof Errors.CantSolveChallenge) {
    if (error.meta.type === 'dns-01') {
      output.error(`The certificate provider could not resolve the DNS queries for ${error.meta.domain}.`)
      output.print(`  This might happen to new domains or domains with recent DNS changes. Please retry later.\n`)
    } else {
      output.error(`The certificate provider could not resolve the HTTP queries for ${error.meta.domain}.`)
      output.print(`  The DNS propagation may take a few minutes, please verify your settings:\n\n`)
      output.print(dnsTable([['', 'ALIAS', 'alias.zeit.co']]) + '\n');
    }
    return 1
  } else if (error instanceof Errors.DomainConfigurationError) {
    output.error(`We couldn't verify the propagation of the DNS settings for ${chalk.underline(error.meta.domain)}`)
    if (error.meta.external) {
      output.print(`  The propagation may take a few minutes, but please verify your settings:\n\n`)
      output.print(dnsTable([
        error.meta.subdomain === null
          ? ['', 'ALIAS', 'alias.zeit.co']
          : [error.meta.subdomain, 'CNAME', 'alias.zeit.co']
      ]) + '\n');
    } else {
      output.print(`  We configured them for you, but the propagation may take a few minutes.\n`)
      output.print(`  Please try again later.\n`)
    }
    return 1
  } else if (error instanceof Errors.DomainNameserversNotFound) {
    output.error(`Couldn't find nameservers for the domain ${chalk.underline(error.meta.domain)}`)
    return 1
  } else if (error instanceof Errors.DomainNotVerified) {
    output.error(`The domain used as a suffix ${chalk.underline(error.meta.domain)} is not verified and can't be used as custom suffix.`)
    return 1
  } else if (error instanceof Errors.DomainPermissionDenied) {
    output.error(`You don't have permissions to access the domain used as a suffix ${chalk.underline(error.meta.domain)}.`)
    return 1
  } else if (error instanceof Errors.DomainsShouldShareRoot) {
    // this is not going to happen
    return 1
  } else if (error instanceof Errors.DomainValidationRunning) {
    output.error(`There is a validation in course for ${chalk.underline(error.meta.domain)}. Wait until it finishes.`)
    return 1
  } else if (error instanceof Errors.DomainVerificationFailed) {
    output.error(`We couldn't verify the domain ${chalk.underline(error.meta.domain)}.\n`)
    output.print(`  Please make sure that your nameservers point to ${chalk.underline('zeit.world')}.\n`)
    output.print(`  Examples: (full list at ${chalk.underline('https://zeit.world')})\n`)
    output.print(zeitWorldTable() + '\n');
    output.print(`\n  As an alternative, you can add following records to your DNS settings:\n`)
    output.print(dnsTable([
      ['_now', 'TXT', error.meta.token],
      error.meta.subdomain === null
        ? ['', 'ALIAS', 'alias.zeit.co']
        : [error.meta.subdomain, 'CNAME', 'alias.zeit.co']
    ], {extraSpace: '  '}) + '\n');
    return 1
  } else if (error instanceof Errors.InvalidWildcardDomain) {
    // this should never happen
    output.error(`Invalid domain ${chalk.underline(error.meta.domain)}. Wildcard domains can only be followed by a root domain.`)
    return 1
  } else if (error instanceof Errors.CDNNeedsUpgrade) {
    output.error(`You can't add domains with CDN enabled from an OSS plan`)
    return 1
  } else if (error instanceof Errors.TooManyCertificates) {
    output.error(`Too many certificates already issued for exact set of domains: ${error.meta.domains.join(', ')}`)
    return 1
  } else if (error instanceof Errors.TooManyRequests) {
    output.error(`Too many requests detected for ${error.meta.api} API. Try again in ${ms(error.meta.retryAfter * 1000, { long: true })}.`)
    return 1
  } else if (error instanceof Errors.DomainNotFound) {
    output.error(`The domain used as a suffix ${chalk.underline(error.meta.domain)} no longer exists. Please update or remove your custom suffix.`)
    return 1
  }

  return error
}

module.exports = main
