import Foundation
import LocalAuthentication

let context = LAContext()
var error: NSError?
let available = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
if CommandLine.arguments.contains("--check") {
    print(available ? "available" : "unavailable")
    exit(0)
}
guard available else { exit(1) }
context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "autoriser la réinitialisation du mot de passe") { success, _ in
    if success { FileHandle.standardOutput.write(Data("verified\n".utf8)) }
    exit(success ? 0 : 1)
}
RunLoop.main.run(until: Date(timeIntervalSinceNow: 110))
context.invalidate()
exit(1)
