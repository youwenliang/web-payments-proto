//import "../css/payment-sheet.css";
import "dialog-polyfill/dialog-polyfill.css";
import AddressCollector from "./datacollectors/AddressCollector";
import CreditCardCollector from "./datacollectors/CreditCardCollector";
import DataSheet from "./PaymentSheet.DataSheet.js";
import DataSheetManager from "./DataSheetManager";
import db from "./AutofillDB";
import dialogPolyfill from "dialog-polyfill/dialog-polyfill";
import EventTarget from "event-target-shim";
import Host from "./PaymentSheet.Host";
import hyperHTML from "hyperhtml/hyperhtml.js";
import LineItems from "./PaymentSheet.LineItems";
import PaymentMethodChooser from "./datacollectors/PaymentMethodChooser";
import ShippingOptions from "./PaymentSheet.ShippingOptions";
import Total from "./PaymentSheet.Total";
import PaymentConfirmationCollector
  from "./datacollectors/PaymentConfirmationCollector";
import AwaitPaymentResponse from "./PaymentSheet.AwaitPaymentResponse";

const privates = new WeakMap();
const eventListeners = Object.freeze([
  "shippingoptionchange",
  "shippingaddresschange",
  "abort",
]);
/**
 * Payment Sheet a HTMLDialogElement that is composed of two section:
 *  Top section:
 *    [x] Heading + image
 *    [x] Line items
 *    [x] Shipping selector
 *    [x] Total
 *
 *  DataSheets
 *    [x] Payment Method Selector
 *  
 *  Bottom info
 *    [x] host information
 */
class PaymentSheet extends EventTarget(eventListeners) {
  constructor() {
    super();
    console.log("Creating payment sheet");
    const priv = privates.set(this, new Map()).get(this);
    initDialog.call(this);

    // WIDGETS
    priv.set("host-widget", new Host());
    const shippingOptionsPicker = new ShippingOptions();
    shippingOptionsPicker.addEventListener("shippingoptionchange", ev => {
      this.dispatchEvent(ev);
    });
    // TODO: convert to proper manager
    priv.set(
      "topWidgets",
      new Map([
        ["lineItems", { widget: new LineItems(), active: true }],
        [
          "shippingOptionsPicker",
          { widget: shippingOptionsPicker, active: true },
        ],
        ["total", { widget: new Total(), active: true }],
        [
          "awaitPaymentResponse",
          { widget: new AwaitPaymentResponse(), active: false },
        ],
      ])
    );
    priv.set("ready", init.call(this));
  }

  get sessionDone() {
    return privates.get(this).get("sessionPromise").promise;
  }

  get ready() {
    return privates.get(this).get("ready");
  }
  /**
   * Abort showing the sheet.
   *  
   * @param {CustomEvent} ev 
   */
  async abort(reason) {
    console.log("aborting", reason);
    if (db.isOpen()) {
      await db.close();
    }
    const priv = privates.get(this);
    priv.get("dataSheetManager").reset();
    const event = new CustomEvent("abort");
    priv.get("sessionPromise").reject(new DOMException(reason, "AbortError"));
    await this.close();
    this.dispatchEvent(event);
  }

  async open(requestData) {
    const priv = privates.get(this);
    const dialog = priv.get("dialog");
    if (!dialog.isConnected) {
      await attatchDialog(dialog);
    }
    if (priv.get("isShowing")) {
      throw new DOMException("Sheet is already showing", "AbortError");
    }
    priv.set("requestData", requestData);
    priv.set("isShowing", true);
    startPaymentSession(this);
    await this.ready;
    const dataSheetManager = priv.get("dataSheetManager");
    dataSheetManager.update(requestData);
    this.render(requestData);
    dialog.showModal();
    try {
      return await this.sessionDone; // collected data is returned
    } catch (err) {
      throw err;
    }
  }

  async requestClose(reason) {
    const priv = privates.get(this);
    // We need to investigate how to show the different reasons for closing
    switch (reason) {
      case "fail":
        // do sad animation here, wait for user input then close()
        break;
      case "abort":
        // We should let the user know the page is trying to abort.
        // this has complications if they are filling out
        // autofill stuff.
        break;
      case "success":
        // do a success animation here
        priv.get("sessionPromise").resolve();
        break;
      case "unknown": // unknown reason
        break;
      default:
        console.assert(false, "This should never happen: " + reason);
    }
    await this.close();
  }

  async close() {
    const priv = privates.get(this);
    const dialog = priv.get("dialog");
    if (!dialog.hasAttribute("open")) {
      dialog.setAttribute("open", "");
    }
    try {
      dialog.close();
    } catch (err) {
      console.warn("Dialog didn't close correctly", err);
    }
    dialog.remove();
    priv.set("isShowing", false);
  }

  async render(requestData = privates.get(this).get("requestData")) {
    const priv = privates.get(this);
    const renderer = priv.get("renderer");
    const topWidgets = priv.get("topWidgets");
    const host = priv.get("host-widget");
    const dataSheetsManager = priv.get("dataSheetManager");
    const currentSheet = dataSheetsManager.active;
    return renderer`
      <h1>
        <img src="./payment-sheet/images/logo-payment.png" alt="">Firefox Web Payment
      </h1>
      <section id="payment-sheet-top-section">${Array.from(topWidgets.values())
      .filter(({ active }) => active)
      .map(({ widget }) => widget.render(requestData))}</section>
      <section id="payment-sheet-data-sheet" hidden="${currentSheet ? false : true}">${currentSheet ? currentSheet.render(requestData) : ""}</section>
      <section id="payment-sheet-bottom">${host.render(window.location)}<section>
    `;
  }
}

/**
 * @this PaymentSheet
 */
function initDialog() {
  const priv = privates.get(this);
  const dialog = document.createElement("dialog");
  dialogPolyfill.registerDialog(dialog);
  dialog.id = "payment-sheet";
  dialog.addEventListener("cancel", () => {
    this.abort("User aborted.");
  });
  priv.set("dialog", dialog);
  priv.set("renderer", hyperHTML.bind(dialog));
  priv.set("isShowing", false);
}

function attatchDialog(dialog) {
  return new Promise(resolve => {
    var attachAndDone = () => {
      document.body.appendChild(dialog);
      return resolve();
    };
    if (document.readyState === "complete") {
      attachAndDone();
      return;
    }
    window.addEventListener("DOMContentLoaded", attachAndDone);
  });
}

function startPaymentSession(paymentSheet) {
  const priv = privates.get(paymentSheet);
  const invertedPromise = {};
  invertedPromise.promise = new Promise((resolve, reject) => {
    Object.assign(invertedPromise, {
      resolve,
      reject,
    });
  });
  priv.set("sessionPromise", invertedPromise);
}

async function init() {
  console.log("Initializing PaymentSheet");
  const priv = privates.get(this);
  const paymentChooser = await new PaymentMethodChooser().ready;
  console.log("paymentChooser READY!");
  const addressCollector = await new AddressCollector("shipping").ready;
  console.log("AddressCollector READY!");
  addressCollector.addEventListener("shippingaddresschange", ev => {
    this.dispatchEvent(ev);
  });
  const creditCardCollector = await new CreditCardCollector(
    addressCollector
  ).ready;
  console.log("creditCardCollector READY!");
  const paymentConfirmationCollector = await new PaymentConfirmationCollector(
    addressCollector,
    creditCardCollector
  ).ready;
  const addressDataSheet = new DataSheet("Shipping address:", addressCollector);
  const sheets = [
    new DataSheet("Choose your payment method:", paymentChooser, {
      userMustChoose: true,
    }),
    addressDataSheet,
    new DataSheet("", creditCardCollector),
    new DataSheet("", paymentConfirmationCollector, { userMustChoose: true }),
  ];
  addressDataSheet.addEventListener("continue", () => {
    addressCollector.notifyAddressChange();
  });
  sheets.forEach(sheet =>
    sheet.addEventListener("abort", () => {
      this.abort("User aborted.");
    }));
  const dataSheetManager = await new DataSheetManager(sheets).ready;
  console.log("dataSheetManager READY!");
  priv.set("dataSheetManager", dataSheetManager);
  dataSheetManager.addEventListener("update", () => {
    console.log("showing new sheet...");
    this.render();
  });

  dataSheetManager.addEventListener("done", ({ detail: collectedData }) => {
    // Show just the waiting spinner...
    const topWidgets = priv.get("topWidgets");
    Array.from(topWidgets.values()).forEach(obj => obj.active = false);
    topWidgets.get("awaitPaymentResponse").active = true;
    this.render();
    priv.get("sessionPromise").resolve(collectedData);
  });

  return this;
}

const paymentSheet = new PaymentSheet();
export default paymentSheet;
