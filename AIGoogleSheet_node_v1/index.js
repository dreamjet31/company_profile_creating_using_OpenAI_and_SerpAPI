const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");
const axiosRetry = require("axios-retry");
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
const serpApiKey = process.env.GOOGLEAPIKEY;

axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

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

function cleanWebsite(website) {
  if (website) {
    website = website.replace("https://", "");
    website = website.replace("http://", "");
    website = website.split("/")[0];
    return website.toLowerCase();
  } else {
    return false;
  }
}

async function rephraseSearch(company, website) {
  website = cleanWebsite(website);
  if (website) {
    website = website.replace("www", "");
    website = website.split(".");
    let final = company + " ";
    for (let word of website) {
      if (
        word.toLowerCase() !== "" &&
        word.toLowerCase() !== "com" &&
        word.toLowerCase() !== company.toLowerCase()
      ) {
        final += word;
        final += " ";
      }
    }
    const searchResult = await search(final);
    const knowledgeGraph = extractKnowledgeGraph(searchResult);
    return knowledgeGraph;
  } else {
    return false;
  }
}

function extractProfile(knowledgeGraph) {
  const result = {};
  const bannedKeys = ["tabs", "directions", "profiles"];
  for (let key in knowledgeGraph) {
    if (
      !key.includes("link") &&
      !key.includes("id") &&
      !key.includes("map") &&
      !key.includes("hours") &&
      !key.includes("reviews") &&
      !key.includes("people_also_search_for") &&
      !key.includes("__") &&
      !bannedKeys.includes(key)
    ) {
      result[key] = knowledgeGraph[key];
    }
  }
  return result;
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
  if (url) {
    if (!url.includes("http")) {
      url = "https://" + url;
    }
    let tem = url.split("//");
    if (tem.length > 1) {
      url = tem[0] + "//" + tem[1].split("/")[0];
    }
    console.log(url);
    try {
      let { html, status } = await getHtml(url);

      if (status === 200) {
        let removed = removeHeader(html);
        removed = removeNavigationElements(removed);
        let result = extractText(removed);
        return result;
      } else {
        if (tem[0].toLowerCase() === "http:") {
          url = "https://" + tem[1].split("/")[0];
          let { html, status } = await getHtml(url);
          if (status === 200) {
            return html;
          }
        } else if (tem[0].toLowerCase() === "https:") {
          url = "http://" + tem[1].split("/")[0];
          let { html, status } = await getHtml(url);
          if (status === 200) {
            return html;
          }
        }
        return false;
      }
    } catch {
      return false;
    }
  } else {
    return false;
  }
}

function extractKnowledgeGraph(searchResult) {
  if ("knowledge_graph" in searchResult) {
    let knowledgeGraph = searchResult["knowledge_graph"];
    if ("title" in knowledgeGraph) {
      if (knowledgeGraph["title"] === "See results about") {
        return false;
      } else {
        return extractProfile(knowledgeGraph);
      }
    } else {
      if (Object.keys(knowledgeGraph).length > 5) {
        return extractProfile(knowledgeGraph);
      } else {
        return false;
      }
    }
  } else {
    return false;
  }
}

// The profile should be split up as follows

// 1. Overview - please write a quick summary of what the company does. Please be sure to state year it was founded, where the company is headquartered and high level overview of what it does

// 2. Overview of Product and Services - please list out the core products and services and write a summary on each one

async function generateResult(companyName, website, row, prompt) {
  try {
    console.log(companyName, website, row);
    //     let systemMessage = `Please write a company profile for the company named at the end of this prompt. Please follow the following commands

    // Please write in a formal business like style
    // Please write in 3rd person
    // Please write in English
    // While you are generating, always provide exact answers.
    // Do not provide a summary at the end

    // While you are generating, please make sure following things.
    // ###
    // ${prompt}
    // ###

    // The company to write about is ${companyName}
    // And the company's website is ${website}

    // I will provide you some informations about the company.
    // `;
    let systemMessage = `
I want you to act as a helpful assistant to write the overview about companies.
The company to write about is ${companyName}
And the company's website is ${website}

I will provide you some useful informations about company,
`;
    let additionalSys = [];
    let searchResult = await search(companyName);
    let knowledgeGraph = extractKnowledgeGraph(searchResult);
    let htmlTxt = await getRawInformationFromUrl(website);
    htmlTxt = htmlTxt.replace("\\t", "");
    htmlTxt = htmlTxt.replace("\\n", "");

    if (htmlTxt.length > 25000) {
      htmlTxt = htmlTxt.substring(0, 20000);
    }

    if (knowledgeGraph !== false) {
      if ("website" in knowledgeGraph) {
        if (cleanWebsite(knowledgeGraph["website"]) === cleanWebsite(website)) {
          let knowledgeMessage = `This is the company information from google search.
###
${JSON.stringify(knowledgeGraph)}
###`;
          additionalSys.push(knowledgeMessage);
          if (htmlTxt !== false) {
            let websiteMessage = `This is the company information from the company's website
###
${htmlTxt}
###`;
            additionalSys.push(websiteMessage);
          }
        } else {
          if (htmlTxt !== false) {
            let websiteMessage = `This is the company information from the company's website
###
${htmlTxt}
###`;
            additionalSys.push(websiteMessage);
            let newKnowledge = await rephraseSearch(companyName, website);
            if (newKnowledge !== false) {
              if (
                cleanWebsite(newKnowledge["website"]) === cleanWebsite(website)
              ) {
                let knowledgeMessage = `This is the company information from google search.
###
${JSON.stringify(newKnowledge)}
###`;
                additionalSys.push(knowledgeMessage);
              }
            }
          }
        }
      } else {
        let newKnowledge = await rephraseSearch(companyName, website);
        if (newKnowledge !== false) {
          if (cleanWebsite(newKnowledge["website"]) === cleanWebsite(website)) {
            let knowledgeMessage = `This is the company information from google search.
###
${JSON.stringify(newKnowledge)}
###`;
            additionalSys.push(knowledgeMessage);
          }
        }
        if (htmlTxt !== false) {
          let websiteMessage = `This is the company information from the company's website
###
${htmlTxt}
###`;
          additionalSys.push(websiteMessage);
        }
      }
    } else {
      let newKnowledge = await rephraseSearch(companyName, website);
      if (newKnowledge !== false) {
        if (cleanWebsite(newKnowledge["website"]) === cleanWebsite(website)) {
          let knowledgeMessage = `This is the company information from google search.
###
${JSON.stringify(newKnowledge)}
###`;
          additionalSys.push(knowledgeMessage);
        }
      }
      if (htmlTxt !== false) {
        let websiteMessage = `This is the company information from the company's website
###
${htmlTxt}
###`;
        additionalSys.push(websiteMessage);
      }
    }

    let mes = [{ role: "system", content: systemMessage }];
    for (let m of additionalSys) {
      mes.push({ role: "system", content: m });
    }
    // console.log("====");
    let prompt_new =
      prompt +
      `
While you are generating, always provide useful informations as much as possible, such as founded date, location, etc if they are provided before.
`;
    console.log(row);
    mes.push({
      role: "system",
      content: prompt_new,
      //       content: `Write an overview based on the informations I provided.
      // When you are writing only provide correct answers from the information I provided.
      // If the company is investment company, please be factual and not be creative or fluffy
      // If there's somethings that are not provided above, do not generate any answer related that.

      // While you are writing only provide actual informations. Do not use templates with [].

      // For example,

      // Wrong answers:
      // The company was founded in [year].
      // This company is headquatered in [location of company].
      // [number of years] of experience.

      // correct answers:
      // The company was founded in 1992.
      // This company is headquatered in Washington, DC.
      // 5 of experience.
      // `,
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
    console.log(row);
    console.log(response.data.choices[0].message.content);
    updateSpreadsheet(
      row,
      "A",
      response.data.choices[0].message.content,
      outputSheetName
    );
    //   return response.data.choices[0].message.content;
  } catch (err) {
    console.log(err);
  }
}

async function main() {
  const data = await testGetSpreadSheetValues(inputSheetName);
  const prompt = await testGetSpreadSheetValues(promptSheetName);
  const urlList = data.slice(1).map((el) => {
    return [el[0], el[1]];
  });
  const time = new Date().getTime();

  for (let i = 0; i < Math.ceil(urlList.length / parallel); i++) {
    const slice = urlList.slice(parallel * i, parallel * (i + 1));
    const requests = slice.map((url, index) =>
      generateResult(url[0], url[1], i * parallel + index + 2, prompt[1][0])
    );
    await Promise.allSettled(requests);
  }
  const last = new Date().getTime();

  console.log("Time => ", last - time);
}

app.get("/api/execute", async (req, res) => {
  await main();
  res.json({ message: "GET request to /api/execute was successful" });
});

app.listen(process.env.PORT, () => {
  console.log(`Server is running`);
});
