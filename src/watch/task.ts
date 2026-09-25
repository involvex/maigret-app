/**
 * Background worker registration. This module is imported for its side
 * effect (TaskManager.defineTask must run at bundle load, including
 * headless launches) — see the import in `src/app/_layout.tsx`.
 */
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { runWatchCycle } from "./check";
import { defaultWatchDeps } from "./wiring";

export const WATCH_TASK_NAME = "maigret-watch-check";

TaskManager.defineTask(WATCH_TASK_NAME, async () => {
  try {
    await runWatchCycle(defaultWatchDeps());
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerWatchTask(
  minimumIntervalMinutes: number,
): Promise<void> {
  await BackgroundTask.registerTaskAsync(WATCH_TASK_NAME, {
    minimumInterval: minimumIntervalMinutes,
  });
}

export async function unregisterWatchTask(): Promise<void> {
  await BackgroundTask.unregisterTaskAsync(WATCH_TASK_NAME);
}

export async function isWatchTaskRegistered(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(WATCH_TASK_NAME);
}

export function getWatchTaskStatus(): Promise<BackgroundTask.BackgroundTaskStatus | null> {
  return BackgroundTask.getStatusAsync();
}

/** Dev builds only: fires the worker immediately without waiting for the OS. */
export function triggerWatchTaskForTesting(): Promise<boolean> {
  return BackgroundTask.triggerTaskWorkerForTestingAsync();
}
