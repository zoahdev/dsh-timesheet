/** bin entry for dsh-timesheet. */

import { main } from './cli.js'

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
})