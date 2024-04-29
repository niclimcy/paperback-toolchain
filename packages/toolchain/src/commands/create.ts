// src/create.ts
import * as path from 'node:path'
import * as fs from 'node:fs'
import {mkdir, cp} from 'node:fs/promises'
import {CLICommand} from '../command'
import {CliUx} from '@oclif/core'
// import {renderFile} from 'ejs'
import shell from 'shelljs'

const templateDir = path.join(__dirname, '../template')

export class Create extends CLICommand {
  static description = 'create a new project';

  async run() {
    const projectName = await promptProjectPath()
    const projectAuthor = await CliUx.ux.prompt('Enter Project Author')
    const git = await CliUx.ux.confirm('Initialize git? (y/n)')

    const projectDir = `./${projectName}`

    // Create project directory
    await mkdir(projectDir, {recursive: true})

    // Copy tsconfig
    await cp(`${templateDir}/tsconfig.json`, `${projectDir}/tsconfig.json`)

    // Parse existing package.json
    const packageJson = await JSON.parse(fs.readFileSync(`${templateDir}/package.json`, 'utf-8'))
    packageJson.name = projectName
    packageJson.author = projectAuthor

    // Generate nice repoName and description based off path
    let repoName = projectName.replace('-', ' ')
    repoName = repoName.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    packageJson.repositoryName = `${repoName} (0.8)`
    packageJson.description = `${repoName} for 0.8!`

    fs.writeFileSync(`${projectDir}/package.json`, JSON.stringify(packageJson, undefined, 2))

    // Copy over template source
    fs.cpSync(`${templateDir}/src`, `${projectDir}/src`, {recursive: true})

    if (git) {
      // Initialize Git repository
      shell.exec(`git init -b main ${projectDir}`)
      shell.exec
    }

    console.log('Project created successfully!')
    console.log('Run npm i to install the necessary packages!')
  }
}

function isValidFileName(fileName: string) {
  const validChars = /^[\w.-]+$/
  return validChars.test(fileName)
}

async function promptProjectPath(): Promise<string> {
  const name = await CliUx.ux.prompt('Enter Project Path')

  if (!isValidFileName(name)) {
    console.log('Invalid character entered, try again!')
    return promptProjectPath()
  }

  return name
}
