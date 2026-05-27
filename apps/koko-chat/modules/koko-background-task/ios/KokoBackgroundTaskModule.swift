import ExpoModulesCore
import UIKit

public class KokoBackgroundTaskModule: Module {
  private let lock = NSLock()
  private var activeTasks: [String: UIBackgroundTaskIdentifier] = [:]

  public func definition() -> ModuleDefinition {
    Name("KokoBackgroundTask")

    AsyncFunction("begin") { (name: String) -> String? in
      let token = UUID().uuidString
      let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
      let taskName = trimmedName.isEmpty ? "KokoChat Background Task" : trimmedName
      var taskId = UIBackgroundTaskIdentifier.invalid

      let startTask = {
        taskId = UIApplication.shared.beginBackgroundTask(withName: taskName) { [weak self] in
          self?.endTask(token)
        }
      }

      if Thread.isMainThread {
        startTask()
      } else {
        DispatchQueue.main.sync(execute: startTask)
      }

      guard taskId != .invalid else {
        return nil
      }

      lock.lock()
      activeTasks[token] = taskId
      lock.unlock()

      return token
    }

    AsyncFunction("end") { (token: String) in
      self.endTask(token)
    }

    AsyncFunction("getBackgroundTimeRemaining") { () -> Double in
      var remaining = 0.0
      let readRemaining = {
        remaining = UIApplication.shared.backgroundTimeRemaining
      }
      if Thread.isMainThread {
        readRemaining()
      } else {
        DispatchQueue.main.sync(execute: readRemaining)
      }
      return remaining
    }
  }

  private func endTask(_ token: String) {
    lock.lock()
    let taskId = activeTasks.removeValue(forKey: token)
    lock.unlock()

    guard let taskId, taskId != .invalid else {
      return
    }

    DispatchQueue.main.async {
      UIApplication.shared.endBackgroundTask(taskId)
    }
  }
}
