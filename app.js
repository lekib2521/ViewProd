
const express = require("express");
const app = express();
const port = 8080;
var cors = require('cors');
app.use(cors());
app.use(express.json({ type: "*/*", limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));
require('dotenv').config();
const { MongoClient } = require('mongodb');
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");
const { AzureCosmosDBVectorStore } = require("@langchain/community/vectorstores/azure_cosmosdb")
const { OpenAIEmbeddings, ChatOpenAI } = require("@langchain/openai")
// To support the LangChain LCEL RAG chain
// const { PromptTemplate }  = require("@langchain/core/prompts")
const { RunnableSequence, RunnablePassthrough } = require("@langchain/core/runnables")
// const { StringOutputParser } = require("@langchain/core/output_parsers")
// For LangChain agent
const { DynamicTool } = require("@langchain/core/tools");
const { AgentExecutor } = require("langchain/agents");
const { MessagesPlaceholder, ChatPromptTemplate } = require("@langchain/core/prompts");
const { convertToOpenAIFunction } = require("@langchain/core/utils/function_calling");
const { OpenAIFunctionsAgentOutputParser } = require("langchain/agents/openai/output_parser");
const { formatToOpenAIFunctionMessages } = require("langchain/agents/format_scratchpad");

// set up the MongoDB client
const dbClient = new MongoClient("mongodb+srv://cosmicworksadmin:shwan%40spence5@dg3bj4g7op62fkq-mongo.mongocluster.cosmos.azure.com/?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000");
// set up the Azure OpenAI client 
const embeddingsDeploymentName = "embeddings";
const completionsDeploymentName = "completions";
const aoaiClient = new OpenAIClient("https://" + "dg3bj4g7op62fkq-openai" + ".openai.azure.com/",
    new AzureKeyCredential("76f0bf1f3f5c4734a811c006a0f138e7"));
// set up the Azure Cosmos DB vector store using the initialized MongoDB client
const azureCosmosDBConfig = {
    client: dbClient,
    databaseName: "cosmic_works",
    collectionName: "products",
    indexName: "VectorSearchIndex",
    embeddingKey: "contentVector",
    textKey: "_id"
}
const vectorStore = new AzureCosmosDBVectorStore(new OpenAIEmbeddings(), azureCosmosDBConfig);
// set up the OpenAI chat model
const chatModel = new ChatOpenAI();

// formatting focs into JSON string to be used in prompt for LLM
function formatDocuments(docs) {
    // Prepares the product list for the system prompt.  
    let strDocs = "";
    for (let index = 0; index < docs.length; index++) {
        let doc = docs[index];
        let docFormatted = { "_id": doc.pageContent };
        Object.assign(docFormatted, doc.metadata);

        // Build the product document without the contentVector and tags
        if ("contentVector" in docFormatted) {
            delete docFormatted["contentVector"];
        }
        if ("tags" in docFormatted) {
            delete docFormatted["tags"];
        }

        // Add the formatted product document to the list
        strDocs += JSON.stringify(docFormatted, null, '\t');

        // Add a comma and newline after each item except the last
        if (index < docs.length - 1) {
            strDocs += ",\n";
        }
    }
    // Add two newlines after the last item
    strDocs += "\n\n";
    return strDocs;
}

// langchain agent executor
async function buildAgentExecutor(stage) {
    // A system prompt describes the responsibilities, instructions, and persona of the AI.
    // Note the variable placeholders for the list of products and the incoming question are not included.
    // An agent system prompt contains only the persona and instructions for the AI.
    //        {"product": "product_name", "features": ["feature1", "feature2", ...], "description": "product_description"}
    let JSONString = `[
        {product: "product_name", features: ["feature1", "feature2", ...], description: "product_description"},
        {product: "product_name", features: ["feature1", "feature2", ...], description: "product_description"},
        {product: "product_name", features: ["feature1", "feature2", ...], description: "product_description"}

    ]`
    let JSONFeatureString = `[
        {feature:"feature_name", desirability: 10, viability: 10, feasibility: 10},
        {feature:"feature_name", desirability: 10, viability: 10, feasibility: 10},
        {feature:"feature_name", desirability: 10, viability: 10, feasibility: 10},
    ]`
    let systemMessage = "";
    // console.log("stage",stage);
    if(stage==1){
    systemMessage = `
        You are a helpful, knowledgeable and friendly product consultant for Cosmic Works, a consultancy service.
        Your name is Cosmo.
        Product Managers come to Cosmo for advice on potential products that they want to build for their end customers.
        You are designed to answer questions about what product to build based on end consumer and their pain point that the product is expected to solve.
        If you are asked a question that is not in the list, respond with the best of your knowledge.
        Based on the requirement generate only 3 different products that can be built with a product name, features, and description.
        Take the role of a JSON formatter, follow these Strict Rules: 
        Only answer questions in JSON format with the keys product_name:string, features:array[], and description:string.
        Each object should be separated by a comma. 
        Do not nest objects in output
        `
    } else {
        // console.log("stage 2");
    systemMessage = `You are a helpful, knowledgeable and friendly product consultant for Cosmic Works, a consultancy service.
        Your name is Cosmo.
        Product Managers come to Cosmo for advice on potential products that they want to build for their end customers.
        You are designed to answer questions about what product to build based on end consumer and their pain point that the product is expected to solve.
        Assess each feature in the features list and score the feature out of 10 on its customer desirablity, financial viability and technical feasibility.
        Take the role of a JSON formatter, follow these Strict Rules: 
        Only answer questions in JSON format with the keys feature:string, desirability:integer, viability:integer, feasibility:integer.
        Each object should be separated by a comma. 
        Do not nest objects in output
        `
    }
    // Create vector store retriever chain to retrieve documents and formats them as a string for the prompt.
    const retrieverChain = vectorStore.asRetriever().pipe(formatDocuments);

    // Define tools for the agent can use, the description is important this is what the AI will 
    // use to decide which tool to use.

    // A tool that retrieves product information from Cosmic Works based on the user's question.
    const productsRetrieverTool = new DynamicTool({
        name: "products_retriever_tool",
        description: stage==1? `Searches Cosmic Works product information for similar products based on the question. 
                Only answer questions as an array of objects in the following JSON format: {JSONString}`:
                `Based on features in similar products, assess each feature in the features list and score the feature out of 10 on its customer desirablity, financial viability and technical feasibility.
                Only answer questions as an array of objects in the following JSON format: {JSONFeatureString}`,
        func: async (input) => await retrieverChain.invoke(input),
    });

    // Generate OpenAI function metadata to provide to the LLM
    // The LLM will use this metadata to decide which tool to use based on the description.
    const tools = [productsRetrieverTool];
    const modelWithFunctions = chatModel.bind({
        functions: tools.map((tool) => convertToOpenAIFunction(tool)),
    });

    // OpenAI function calling is fine-tuned for tool using therefore you don't need to provide instruction.
    // All that is required is that there be two variables: `input` and `agent_scratchpad`.
    // Input represents the user prompt and agent_scratchpad acts as a log of tool invocations and outputs.
    const prompt = ChatPromptTemplate.fromMessages([
        ["system", systemMessage],
        ["human", "{input}"],
        new MessagesPlaceholder(variable_name = "agent_scratchpad")
    ]);

    // Define the agent and executor
    // An agent is a type of chain that reasons over the input prompt and has the ability
    // to decide which function(s) (tools) to use and parses the output of the functions.
    const runnableAgent = RunnableSequence.from([
        {
            input: (i) => i.input,
            agent_scratchpad: (i) => formatToOpenAIFunctionMessages(i.steps),
        },
        prompt,
        modelWithFunctions,
        new OpenAIFunctionsAgentOutputParser(),
    ]);

    // An agent executor can be thought of as a runtime, it orchestrates the actions of the agent
    // until completed. This can be the result of a single or multiple actions (one can feed into the next).
    // Note: If you wish to see verbose output of the tool usage of the agent, 
    //       set returnIntermediateSteps to true
    const executor = AgentExecutor.fromAgentAndTools({
        agent: runnableAgent,
        tools,
        //returnIntermediateSteps: true
    });

    return executor;
}

// Helper function that executes the agent with user input and returns the string output
async function executeAgent(agentExecutor, input) {
    // Invoke the agent with the user input
    const result = await agentExecutor.invoke({ input });

    // Output the intermediate steps of the agent if returnIntermediateSteps is set to true
    if (agentExecutor.returnIntermediateSteps) {
        console.log(JSON.stringify(result.intermediateSteps, null, 2));
    }
    // Return the final response from the agent
    return result.output;
}

function extractSubstringsToObjects(str,stage) {
    const matches = [];
    let startIndex = 0;
    str = str.replace(/\n/g, '').trim();
    console.log(str);

    while (startIndex < str.length) {
        console.log("hete");
        let openIndex = stage==1? str.indexOf('"product_name"', startIndex): str.indexOf('"feature"', startIndex);
        if (openIndex === -1) break;

        let closeIndex = str.indexOf('}', openIndex);
        if (closeIndex === -1) break;

        console.log("we are here",str.substring(openIndex, closeIndex));
        let content = JSON.parse(`{${str.substring(openIndex, closeIndex).trim()}}`);
        matches.push(content);

        startIndex = closeIndex + 1;
    }

    return matches;
}


async function main(req, res) {
    try {
        await dbClient.connect();
        console.log('Connected to MongoDB');
        const agentExecutor = await buildAgentExecutor(req.query.stage);
        stage = req.query.stage;
        let botresp={};
        if(req.query.stage==1){
            botresp = await executeAgent(agentExecutor, `What are the features I can integrate in an app for ${req.query.customer} to solve the painpoint ${req.query.pain}?`);
        } else {
            botresp = await executeAgent(agentExecutor, `Assess the features in ${req.query.features} that I can integrate in an app for ${req.query.description} to solve the painpoint ${req.query.pain} using the feature assessment framework`);
        }
        const substrings = extractSubstringsToObjects(botresp, req.query.stage);
        console.log(substrings);
        // res.setHeader('Access-Control-Allow-Origin', 'http://localhost:4200');
        res.send(substrings);
    } catch (err) {
        console.error(err);
    } finally {
        await dbClient.close();
        console.log('Disconnected from MongoDB');
    }
}


app.get("/", (req, res) => {
    // calling main function
    console.log(req.query);
    main(req,res).catch(console.error);
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}!`);
});

// // calling main function
// main().catch(console.error);
