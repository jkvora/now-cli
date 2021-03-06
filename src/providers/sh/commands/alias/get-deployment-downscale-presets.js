// @flow
import type { NpmDeployment, DockerDeployment, DeploymentScaleArgs } from '../../util/types'

function getDeploymentDownscalePresets(deployment: NpmDeployment | DockerDeployment): DeploymentScaleArgs {
  return Object.keys(deployment.scale).reduce((result, dc) => {
    return Object.assign(result, {
      [dc]: { min: 0, max: 1 }
    })
  }, {})
}

export default getDeploymentDownscalePresets
