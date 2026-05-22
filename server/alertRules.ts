export type AlertSignal = "cutloss" | "sale" | "none";

export function determineAlertSignal(input: {
  price: number;
  cutloss: number | null;
  sale: number | null;
}): AlertSignal {
  if (input.cutloss !== null && input.price <= input.cutloss) {
    return "cutloss";
  }

  if (input.sale !== null && input.price >= input.sale) {
    return "sale";
  }

  return "none";
}

export function shouldSendAlert(input: {
  nextSignal: AlertSignal;
  previousSignal: AlertSignal;
  alertsEnabled: boolean;
  hasLineRecipient: boolean;
  sendAlerts: boolean;
}) {
  return (
    input.sendAlerts &&
    input.alertsEnabled &&
    input.hasLineRecipient &&
    input.nextSignal !== "none" &&
    input.previousSignal !== input.nextSignal
  );
}
