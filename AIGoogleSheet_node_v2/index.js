const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");
const axiosRetry = require("axios-retry");
const { ZenRows } = require("zenrows");
const retry = require("async-retry");

const {
  getAuthToken,
  getSpreadSheet,
  getSpreadSheetValues,
  addValuesSpreadSheet,
  updateValuesSpreadSheet,
  updateRangeValuesSpreadSheet,
} = require("./googleSheetsService.js");
require("dotenv").config();

const app = express();
app.use(cors());
const parallel = Number(process.env.PARALLEL);
const spreadsheetId = process.env.SPREADSHEETID;

const promptSheetName = process.env.PROMPTSHEETNAME;
const inputSheetName = process.env.INPUTSHEETNAME;
const outputSheetName = process.env.OUTPUTSHEETNAME;
const openaiApiKey = process.env.OPENAIAPIKEY;
const ZENROWSAPIKEY = process.env.ZENROWSAPIKEY;
const serpApiKey = process.env.GOOGLEAPIKEY;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const client = new ZenRows(ZENROWSAPIKEY, {
  concurrency: parallel,
  retries: 1,
});
axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

let linkedinResults = [];
async function search(query) {
  const params = {
    q: query,
    location: "Austin, Texas, United States",
    hl: "en",
    gl: "us",
    google_domain: "google.com",
    api_key: serpApiKey,
  };

  const response = await axios.get("https://serpapi.com/search", { params });
  return response.data;
}

async function testGetSpreadSheet() {
  try {
    const auth = await getAuthToken();
    const response = await getSpreadSheet({
      spreadsheetId,
      auth,
    });
    console.log(
      "output for getSpreadSheet",
      JSON.stringify(response.data, null, 2)
    );
  } catch (error) {
    console.log(error.message, error.stack);
  }
}

async function testGetSpreadSheetValues(sheetName) {
  try {
    const auth = await getAuthToken();
    const response = await getSpreadSheetValues({
      spreadsheetId,
      sheetName,
      auth,
    });
    // console.log(JSON.stringify(response.data.values, null, 2));
    return response.data.values;
  } catch (error) {
    // console.log(error.message, error.stack);
    return error.message;
  }
}

async function testAddValuesSpreadSheet() {
  try {
    const auth = await getAuthToken();
    const response = await addValuesSpreadSheet({
      spreadsheetId,
      sheetName,
      auth,
      values,
    });
    console.log(
      "output for addValuesSpreadSheet",
      JSON.stringify(response.data, null, 2)
    );
  } catch (error) {
    console.log(error.message, error.stack);
  }
}

async function updateSpreadsheet(row, column, value, sheetName) {
  try {
    // Get the authentication token
    const auth = await getAuthToken();

    // Update the value in the spreadsheet
    const response = await updateValuesSpreadSheet({
      spreadsheetId,
      auth,
      sheetName,
      row,
      column,
      value,
    });
    // console.log("Value updated successfully:", response.data);
  } catch (error) {
    console.error("Error updating value:", error);
  }
}

async function updateRangeSpreadsheet(range, values) {
  try {
    // Get authentication token
    const auth = await getAuthToken();

    // Range and values to update
    // const range = "B2:F2";
    // const values = ["Value1", "Value2", "Value3", "Value4", "Value5"];

    // Update the range with the values
    const response = await updateRangeValuesSpreadSheet({
      spreadsheetId,
      auth,
      sheetName,
      range,
      values,
    });

    // console.log("Range updated successfully:", response.data);
  } catch (error) {
    console.error("Error updating range:", error);
  }
}

function removeNavigationElements(html) {
  const $ = cheerio.load(html);
  $('[id*="navigation"]').remove();
  return $.html();
}

function removeHeader(html) {
  const $ = cheerio.load(html);
  $("header").remove();
  $("footer").remove();
  return $.html();
}

function extractText(html) {
  const $ = cheerio.load(html);
  $("script, style").remove();
  return $.text().trim();
}

async function getHtml(url) {
  const response = await axios.get(url);
  return { html: response.data, status: response.status };
}

async function getRawInformationFromUrl(url) {
  try {
    let { html, status } = await getHtml(url);

    if (status === 200) {
      let removed = removeHeader(html);
      removed = removeNavigationElements(removed);
      let result = extractText(removed);
      return result;
    } else {
      return false;
    }
  } catch {
    return false;
  }
}

const extractLinks = (plainHtml, url) => {
  const $ = cheerio.load(plainHtml);
  let links = [];
  $("a").each((i, link) => {
    links.push($(link).attr("href"));
  });

  const filteredLinks = links.filter((link) => link.includes(url));
  return filteredLinks;
};

const extractLinkedin = async (url) => {
  const run = async (bail, attemptNumber) => {
    return await client
      .get(url, { js_render: true, premium_proxy: true })
      .then((response) => {
        let result = [];
        const $ = cheerio.load(response.data);
        const employees = $(
          'a[data-tracking-control-name="org-employees_cta_face-pile-cta"]'
        );
        if (employees.length) {
          const string = employees.text().trim();
          const prefix = "View all ";
          const suffix = " employees";

          const extractedString = string.substring(
            prefix.length,
            string.length - suffix.length
          );
          result[4] = extractedString;
        }

        const name = $("h1");
        if (name.length) result[0] = name.text().trim();

        const purpose = $("h4");
        if (purpose.length) result[10] = purpose.text().trim();

        const about = $('p[data-test-id="about-us__description"]');
        if (about.length) result[11] = about.text().trim();

        const website = $('div[data-test-id="about-us__website"] a');
        if (website.length) result[1] = website.text().trim();
        const industries = $('div[data-test-id="about-us__industries"] dd');
        if (industries.length) result[2] = industries.text().trim();
        const size = $('div[data-test-id="about-us__size"] dd');
        if (size.length) result[3] = size.text().trim();
        const headquarters = $('div[data-test-id="about-us__headquarters"] dd');
        if (headquarters.length) result[6] = headquarters.text().trim();
        const type = $('div[data-test-id="about-us__organizationType"] dd');
        if (type.length) result[7] = type.text().trim();
        const speciality = $('div[data-test-id="about-us__specialties"] dd');
        if (speciality.length) result[8] = speciality.text().trim();
        const founded = $('div[data-test-id="about-us__foundedOn"] dd');
        if (founded.length) result[12] = founded.text().trim();
        const addresses = $("#address-0 p");

        if (addresses.length) {
          result[5] = addresses.text().trim().split(", ").slice(-1)[0];
          result[9] = addresses.text().trim();
        }

        linkedinResults = result;
      })
      .catch((error) => {
        if (error.response && error.response.status === 429) {
          // HTTP status code for quota limit reached
          throw error;
        } else {
          bail(error); // If not a rate limit error, don't retry and throw an error
        }
        console.log(error.data);
      });
  };
  try {
    // Use the async-retry library to retry the HTTP request if error 429 is received
    await retry(run, {
      retries: 5, // The maximum amount of times to retry the operation Default is 10
      factor: 2, // The exponential factor to use Default is 2
      minTimeout: 1000, // The number of milliseconds before starting the first retry Default is 1000
      maxTimeout: Infinity, // The maximum number of milliseconds between two retries Default is Infinity
      randomize: true, // Randomizes the timeouts by multiplying a factor between 1-2 Default is false
      onRetry: (error, attemptNumber) =>
        console.log(`Retrying request... Attempt number: ${attemptNumber}`), // Called each time a retry is made.
    });
  } catch (err) {
    console.error("Request failed after 5 retries:", err);
  }
};

const createLinkedinSentence = async (url) => {
  await extractLinkedin(url);
  let linkedinSentence = "";
  if (linkedinResults[0]) {
    linkedinSentence += "The company name is " + linkedinResults[0] + ". ";
  }
  if (linkedinResults[1]) {
    linkedinSentence += "The company's website is " + linkedinResults[1] + ". ";
  }
  if (linkedinResults[2]) {
    linkedinSentence +=
      "The company's industry is " + linkedinResults[2] + ". ";
  }
  if (linkedinResults[3]) {
    linkedinSentence += "The company has between " + linkedinResults[3] + ". ";
  }
  if (linkedinResults[5]) {
    linkedinSentence +=
      "The company's nationality is " + linkedinResults[5] + ". ";
  }
  if (linkedinResults[6]) {
    linkedinSentence +=
      "The company is headquartered in " + linkedinResults[6] + ". ";
  }
  if (linkedinResults[7]) {
    linkedinSentence += "The company type is " + linkedinResults[7] + ". ";
  }
  if (linkedinResults[8]) {
    linkedinSentence +=
      "The company's speciality is " + linkedinResults[8] + ". ";
  }
  if (linkedinResults[9]) {
    linkedinSentence += "The company's address is " + linkedinResults[9] + ". ";
  }
  if (linkedinResults[10]) {
    linkedinSentence += "The company's role is " + linkedinResults[10] + ". ";
  }
  if (linkedinResults[11]) {
    linkedinSentence +=
      "Here's an overview of the company. " + linkedinResults[11] + ". ";
  }
  if (linkedinResults[12]) {
    linkedinSentence +=
      "The company was founded in " + linkedinResults[12] + ". ";
  }
  return [linkedinSentence, linkedinResults[1], linkedinResults[0]];
};

const contentFromFiltering = async (filteredLinks) => {
  let content = "";
  for (const link of filteredLinks) {
    const result = await getRawInformationFromUrl(link);
    content += result;
  }
  return content;
};

const generateResult = async (url, row, prompt) => {
  try {
    let sentence = "",
      website = "",
      companyName = "";
    const result = await createLinkedinSentence(url);

    sentence = result[0];
    website = result[1];
    companyName = result[2];
    // let { html, status } = await getHtml(website);
    // let filteredLinks = [];
    // if (status === 200) {
    //   filteredLinks = extractLinks(html, website);
    // }

    let websiteContent = await getRawInformationFromUrl(website);
    // const resultFromFiltering = await contentFromFiltering(filteredLinks);
    // websiteContent += resultFromFiltering;
    websiteContent = websiteContent.replace(/\s+/g, " ");
    // console.log(
    //   filteredLinks,
    //   websiteContent,
    //   websiteContent.length,
    //   websiteContent.split(" ").length
    // );

    sentence = sentence.replace(/\s+/g, " ");
    // console.log("-------");
    // console.log(sentence, sentence.length, sentence.split(" ").length, website);

    let systemMessage = `
    I want you to act as a helpful assistant to write the overview about companies.
    The company to write about is ${companyName}

    I will provide you some useful informations about company.
    `;
    let additionalSys = [];
    let mes = [{ role: "system", content: systemMessage }];
    if (sentence) {
      sentence = "This is the Linkedin profile of the company.\n" + sentence;
      mes.push({ role: "system", content: sentence });
    }
    if (websiteContent) {
      websiteContent =
        "This is the content from the official website of company. \n" +
        websiteContent;
      mes.push({ role: "system", content: websiteContent });
    }

    let prompt_new =
      prompt +
      "While you are generating, always provide useful informations as much as possible, such as founded date, location, etc if they are provided before.";

    mes.push({
      role: "system",
      content: prompt_new,
    });
    const chatCompletionRequest = {
      //   model: "gpt-3.5-turbo-16k-0613",
      model: "gpt-4-0613",
      messages: mes,
    };

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      chatCompletionRequest,
      {
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    updateSpreadsheet(
      row,
      "A",
      response.data.choices[0].message.content,
      outputSheetName
    );
    // return response.data.choices[0].message.content;
  } catch (err) {
    console.log(err);
  }
};

async function main() {
  const data = await testGetSpreadSheetValues(inputSheetName);
  const prompt = await testGetSpreadSheetValues(promptSheetName);
  const urlList = data.slice(1).map((el) => {
    return [el[0], el[1]];
  });
  let linkedinUrls = [];
  for (const url of urlList) {
    console.log(`linkedin ${url[0]} ${url[1]}`)
    const result = await search(`linkedin ${url[0]} ${url[1]}`);
    linkedinUrls.push([result["organic_results"][0]["link"]]);
  }
  const time = new Date().getTime();

  for (let i = 0; i < Math.ceil(linkedinUrls.length / parallel); i++) {
    const slice = linkedinUrls.slice(parallel * i, parallel * (i + 1));
    const requests = slice.map((url, index) =>
      generateResult(url[0], i * parallel + index + 2, prompt[1][0])
    );
    await Promise.allSettled(requests);
  }
  const last = new Date().getTime();

  console.log("Time => ", last - time);
}
main();
// app.get("/api/execute", async (req, res) => {
//   await main();
//   res.json({ message: "GET request to /api/execute was successful" });
// });

// app.listen(process.env.PORT, () => {
//   console.log(`Server is running`);
// });