import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { BattleDashboard } from "./BattleDashboard.ts";

Deno.test("BattleDashboard - Status Updates", () => {
  const container = document.createElement('div');
  const dashboard = new BattleDashboard(container);

  const testBot = {
    id: 'test-bot',
    name: 'Test Bot',
    memoryUsage: 50,
    cyclesExecuted: 1000,
    state: 'running' as const,
    lastInstruction: 'MOV A, B'
  };

  dashboard.updateBotStatus(testBot);
  const botElement = container.querySelector('.bot-item') as HTMLElement;

  assertEquals(botElement?.classList.contains('running'), true);
  assertEquals(botElement?.textContent?.includes('Test Bot'), true);
  assertEquals(botElement?.textContent?.includes('MOV A, B'), true);
});

Deno.test("BattleDashboard - Metrics Calculation", () => {
  const container = document.createElement('div');
  const dashboard = new BattleDashboard(container);

  const metrics = {
    executionSpeed: 1000,
    memoryEfficiency: 75,
    battleProgress: 50
  };

  dashboard.updateMetrics(metrics);

  const execSpeed = container.querySelector('#execSpeed') as HTMLElement;
  const memEfficiency = container.querySelector('#memEfficiency') as HTMLElement;
  const battleProgress = container.querySelector('#battleProgress') as HTMLElement;

  assertEquals(execSpeed?.textContent, '1000.0 IPS');
  assertEquals(memEfficiency?.textContent, '75.0%');
  assertEquals(battleProgress?.textContent, '50.0%');
});

Deno.test("BattleDashboard - Control Panel Functionality", () => {
  const container = document.createElement('div');
  const dashboard = new BattleDashboard(container);

  let battleStarted = false;
  container.addEventListener('battleStart', () => {
    battleStarted = true;
  });

  const startButton = container.querySelector('#startBattle') as HTMLButtonElement;
  startButton?.click();

  assertEquals(battleStarted, true);
});