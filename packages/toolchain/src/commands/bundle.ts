import {Flags} from '@oclif/core'
import {CLICommand} from '../command'
import * as path from 'node:path'
import * as fs from 'node:fs'

import browserify from 'browserify'
import * as shelljs from 'shelljs'
import Utils from '../utils'

// Homepage generation requirement
const pug = require('pug')

export default class Bundle extends CLICommand {
  static override description =
    'Builds all the sources in the repository and generates a versioning file';

  static override flags = {
    help: Flags.help({char: 'h'}),
    folder: Flags.string({description: 'Subfolder to output to', required: false}),
  };

  async run() {
    const {flags} = await this.parse(Bundle)

    this.log(`Working directory: ${process.cwd()}`)
    this.log()

    const execTime = this.time('Execution time', Utils.headingFormat)
    await this.bundleSources(flags.folder)

    const versionTime = this.time('Versioning File', Utils.headingFormat)
    await this.generateVersioningFile(flags.folder)
    versionTime.end()
    this.log()

    const homepageTime = this.time('Homepage Generation', Utils.headingFormat)
    await this.generateHomepage(flags.folder)
    homepageTime.end()
    this.log()

    execTime.end()
  }

  async generateVersioningFile(folder = '') {
    // joining path of directory
    const basePath = process.cwd()
    const directoryPath = path.join(basePath, 'bundles', folder)
    const cliInfo = require('../../package.json')
    const commonsInfo = require(path.join(basePath, 'node_modules/@paperback/types/package.json'))

    const jsonObject = {
      buildTime: new Date(),
      sources: [] as any[],
      builtWith: {
        toolchain: cliInfo.version,
        types: commonsInfo.version,
      },
    }

    const promises = fs.readdirSync(directoryPath).map(async file => {
      if (file.startsWith('.') || file.startsWith('tests')) return

      try {
        const time = this.time(`- Generating ${file} Info`)
        const sourceInfo = await this.generateSourceInfo(file, directoryPath)
        jsonObject.sources.push(sourceInfo)
        time.end()
      } catch (error) {
        this.log(`- ${file} ${error}`)
      }
    })

    await Promise.all(promises)

    // Write the JSON payload to file
    fs.writeFileSync(
      path.join(directoryPath, 'versioning.json'),
      JSON.stringify(jsonObject),
    )
  }

  async generateSourceInfo(sourceId: string, directoryPath: string) {
    // Files starting with . should be ignored (hidden) - Also ignore the tests directory
    if (sourceId.startsWith('.') || sourceId.startsWith('tests')) {
      return
    }

    // If its a directory
    if (!fs.statSync(path.join(directoryPath, sourceId)).isDirectory()) {
      this.log('not a Directory, skipping ' + sourceId)
      return
    }

    const finalPath = path.join(directoryPath, sourceId, 'index.js')

    return new Promise<any>((res, rej) => {
      const req = require(finalPath)

      const classInstance = req[`${sourceId}Info`]

      // make sure the icon is present in the includes folder.
      if (!fs.existsSync(path.join(directoryPath, sourceId, 'includes', classInstance.icon))) {
        rej(new Error('[ERROR] [' + sourceId + '] Icon must be inside the includes folder'))
        return
      }

      res({
        id: sourceId,
        name: classInstance.name,
        author: classInstance.author,
        desc: classInstance.description,
        website: classInstance.authorWebsite,
        contentRating: classInstance.contentRating,
        version: classInstance.version,
        icon: classInstance.icon,
        tags: classInstance.sourceTags,
        websiteBaseURL: classInstance.websiteBaseURL,
        intents: classInstance.intents,
      })
    })
  }

  async bundleSources(folder = '') {
    const cwd = process.cwd()
    const tmpTranspilePath = path.join(cwd, 'tmp')
    const bundlesDirPath = path.join(cwd, 'bundles', folder)

    const transpileTime = this.time('Transpiling project', Utils.headingFormat)
    Utils.deleteFolderRecursive(tmpTranspilePath)
    shelljs.exec('npx tsc --outDir tmp')
    transpileTime.end()

    this.log()

    const bundleTime = this.time('Bundle time', Utils.headingFormat)
    Utils.deleteFolderRecursive(bundlesDirPath)
    fs.mkdirSync(bundlesDirPath, {recursive: true})

    const promises: Promise<void>[] = fs.readdirSync(tmpTranspilePath).map(async file => {
      const fileBundleTime = this.time(`- Building ${file}`)

      Utils.copyFolderRecursive(
        path.join(cwd, 'src', file, 'external'),
        path.join(tmpTranspilePath, file),
      )

      await this.bundle(file, tmpTranspilePath, bundlesDirPath)

      Utils.copyFolderRecursive(
        path.join(cwd, 'src', file, 'includes'),
        path.join(bundlesDirPath, file),
      )

      fileBundleTime.end()
    })

    await Promise.all(promises)

    bundleTime.end()

    this.log()
    // Remove the build folder
    Utils.deleteFolderRecursive(path.join(cwd, 'tmp'))
  }

  async bundle(file: string, sourceDir: string, destDir: string): Promise<void> {
    if (file === 'tests') {
      this.log('Tests directory, skipping')
      return
    }

    // If its a directory
    if (!fs.statSync(path.join(sourceDir, file)).isDirectory()) {
      this.log('Not a directory, skipping ' + file)
      return
    }

    const filePath = path.join(sourceDir, file, `/${file}.js`)

    if (!fs.existsSync(filePath)) {
      this.log("The file doesn't exist, skipping. " + file)
      return
    }

    const outputPath = path.join(destDir, file)
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath)
    }

    await Promise.all([
      // For 0.9 and above
      new Promise<void>(res => {
        browserify([filePath], {standalone: 'Sources'})
        .external(['axios', 'fs'])
        .bundle()
        .pipe(
          fs.createWriteStream(path.join(outputPath, 'index.js')).on('finish', () => {
            res()
          }),
        )
      }),

      // For 0.8; ensures backwards compatibility with 0.7 sources
      new Promise<void>(res => {
        browserify([filePath], {standalone: 'Sources'})
        .external(['axios', 'fs'])
        .bundle()
        .pipe(
          fs.createWriteStream(path.join(outputPath, 'source.js')).on('finish', () => {
            res()
          }),
        )
      }),
    ])
  }

  async generateHomepage(folder = '')  {
    /*
     * Generate a homepage for the repository based on the package.json file and the generated versioning.json
     *
     * Following fields must be registered in package.json:
     * {
     *    repositoryName: "The repository name"
     *    description: "The repository description"
     * }
     * The following fields can be used:
     * {
     *    noAddToPaperbackButton: A boolean used to not generate the AddToPaperback button
     *    repositoryLogo: "Custom logo path or URL"
     *    baseURL: "Custom base URL for the repository"
     * }
     * The default baseURL will be deducted form GITHUB_REPOSITORY environment variable.
     *
     * See website-generation/homepage.pug file for more information on the generated homepage
     */

    // joining path of directory
    const basePath = process.cwd()
    const directoryPath = path.join(basePath, 'bundles', folder)
    const packageFilePath  = path.join(basePath, 'package.json')
    // homepage.pug file is added to the package during the prepack process
    const pugFilePath = path.join(__dirname, '../website-generation/homepage.pug')
    const versioningFilePath  = path.join(directoryPath, 'versioning.json')

    // The homepage should only be generated if a package.json file exist at the root of the repo
    if (fs.existsSync(packageFilePath)) {
      this.log('- Generating the repository homepage')

      // We need data from package.json and versioning.json created previously
      const packageData = JSON.parse(fs.readFileSync(packageFilePath, 'utf8'))
      const extensionsData = JSON.parse(fs.readFileSync(versioningFilePath, 'utf8'))

      // Creation of the list of available extensions
      // [{name: sourceName, tags[]: []}]
      const extensionList: { name: any; tags: any }[] = []

      for (const extension of extensionsData.sources) {
        extensionList.push(
          {
            name: extension.name,
            tags: extension.tags,
          },
        )
      }

      // To be used by homepage.pug file, repositoryData must by of the format:
      /*
        {
          repositoryName: "",
          repositoryDescription: "",
          baseURL: "https://yourlinkhere",
          sources: [{name: sourceName, tags[]: []}]

          repositoryLogo: "url",
          noAddToPaperbackButton: true,
        }
      */
      const repositoryData: {[id: string]: unknown} = {}

      repositoryData.repositoryName = packageData.repositoryName
      repositoryData.repositoryDescription = packageData.description
      repositoryData.sources = extensionList

      // The repository can register a custom base URL. If not, this file will try to deduct one from GITHUB_REPOSITORY
      if (packageData.baseURL === undefined) {
        const githubRepoEnvVar = process.env.GITHUB_REPOSITORY
        if (githubRepoEnvVar === undefined) {
          // If it's not possible to determine the baseURL, using noAddToPaperbackButton will mask the field from the homepage
          // The repository can force noAddToPaperbackButton to false by adding the field to package.json
          this.log('Both GITHUB_REPOSITORY and baseURL are not defined, setting noAddToPaperbackButton to true')
          repositoryData.baseURL = 'undefined'
          repositoryData.noAddToPaperbackButton = true
        } else {
          const split = githubRepoEnvVar.toLowerCase().split('/')
          // The capitalization of folder is important, using folder.toLowerCase() make a non working link
          this.log(`Using base URL deducted from GITHUB_REPOSITORY environment variable: https://${split[0]}.github.io/${split[1]}${(folder === '') ? '' : '/' + folder}`)
          repositoryData.baseURL = `https://${split[0]}.github.io/${split[1]}${(folder === '') ? '' : '/' + folder}`
        }
      } else {
        this.log(`Using custom baseURL: ${packageData.baseURL}`)
        repositoryData.baseURL = packageData.baseURL
      }

      if (packageData.noAddToPaperbackButton !== undefined) {
        this.log('Using noAddToPaperbackButton parameter')
        repositoryData.noAddToPaperbackButton = packageData.noAddToPaperbackButton
      }

      if (packageData.repositoryLogo !== undefined) {
        this.log('Using repositoryLogo parameter')
        repositoryData.repositoryLogo = packageData.repositoryLogo
      }

      // Compilation of the pug file which is available in website-generation folder
      const htmlCode = pug.compileFile(pugFilePath)(
        repositoryData,
      )

      fs.writeFileSync(
        path.join(directoryPath, 'index.html'),
        htmlCode,
      )
    }
  }
}
