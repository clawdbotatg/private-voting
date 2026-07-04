// Deploy MyProgram to a live network (invoked with --network sepolia).
import { deployTemplate } from './default'

deployTemplate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
