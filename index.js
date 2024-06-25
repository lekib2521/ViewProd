require('dotenv').config();
const { MongoClient } = require('mongodb');
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");
const { AzureCosmosDBVectorStore, AzureCosmosDBSimilarityType } = require("@langchain/community/vectorstores/azure_cosmosdb")
const { OpenAIEmbeddings, ChatOpenAI } = require("@langchain/openai")
// To support the LangChain LCEL RAG chain
const { PromptTemplate }  = require("@langchain/core/prompts")
const { RunnableSequence, RunnablePassthrough } = require("@langchain/core/runnables")
const { StringOutputParser } = require("@langchain/core/output_parsers")
// For LangChain agent
const { DynamicTool } = require("@langchain/core/tools");
const { AgentExecutor } = require("langchain/agents");
const { MessagesPlaceholder, ChatPromptTemplate } = require("@langchain/core/prompts");
const { convertToOpenAIFunction } = require("@langchain/core/utils/function_calling");
const { OpenAIFunctionsAgentOutputParser } = require("langchain/agents/openai/output_parser");
const { formatToOpenAIFunctionMessages } = require("langchain/agents/format_scratchpad");

// set up the MongoDB client
const dbClient = new MongoClient(process.env.MONGODB_URI);
// set up the Azure OpenAI client 
const embeddingsDeploymentName = "embeddings";
const completionsDeploymentName = "completions";
const aoaiClient = new OpenAIClient("https://" + process.env.AZURE_OPENAI_API_INSTANCE_NAME + ".openai.azure.com/", 
                    new AzureKeyCredential(process.env.AZURE_OPENAI_API_KEY));
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

async function main() {
    try {
        await dbClient.connect();
        console.log('Connected to MongoDB');
        const db = dbClient.db('cosmic_works');
        // console.log(await generateEmbeddings("Hello, world!"));
        // await addCollectionContentVectorField(db, 'products');
        //vector search for the top 3 most relevant products
        // const searchResults = await vectorSearch(db, 'products', 'What products can I use to impress my boss?');    
        // searchResults.forEach(printProductSearchResult);
        //RAG with vector search for the top 3 most relevant products
        // console.log(await ragWithVectorsearch(db, 'products', 'What product can i build for a small grocery store who wants to go digital?', 3));
        // perform a vector search using the vector store
        // const results = await vectorStore.similaritySearch(
        //     "What features is necessary for a small grocery store who wants to go digital?",
        //     AzureCosmosDBSimilarityType.CosineSimilarity,
        //     3
        // );
        // console.log(results);
        // console.log(await ragLCELChain("What kind of products can I build for bored teenagers?"));
        const agentExecutor = await buildAgentExecutor();
        console.log(await executeAgent(agentExecutor, "What are the features I can integrate in an app for architects?"));
    } catch (err) {
        console.error(err);
    } finally {
        await dbClient.close();
        console.log('Disconnected from MongoDB');
    }
}

// function to generate embedding
async function generateEmbeddings(text) {
    const embeddings = await aoaiClient.getEmbeddings(embeddingsDeploymentName, text, { timeout: 3000 });
    // Rest period to avoid rate limiting on Azure OpenAI  
    await new Promise(resolve => setTimeout(resolve, 500));
    return embeddings.data[0].embedding;
}

// function to store embeddings and vector search indexes
async function addCollectionContentVectorField(db, collectionName) {
    const collection = db.collection(collectionName);
    const docs = await collection.find({}).toArray();
    const bulkOperations = [];
    console.log(`Generating content vectors for ${docs.length} documents in ${collectionName} collection`);
    for (let i = 0; i < docs.length; i++) {
        console.log("heyy", i);
        const doc = docs[i];
        // do not include contentVector field in the content to be embedded
        if ('contentVector' in doc) {
            delete doc['contentVector'];
        }
        const content = JSON.stringify(doc);
        const contentVector = await generateEmbeddings(content);
        bulkOperations.push({
            updateOne: {
                filter: { '_id': doc['_id'] },
                update: { '$set': { 'contentVector': contentVector } },
                upsert: true
            }
        });
        //output progress every 25 documents
        if ((i + 1) % 25 === 0 || i === docs.length - 1) {
            console.log(`Generated ${i + 1} content vectors of ${docs.length} in the ${collectionName} collection`);
        }
    }
    if (bulkOperations.length > 0) {
        console.log(`Persisting the generated content vectors in the ${collectionName} collection using bulkWrite upserts`);
        await collection.bulkWrite(bulkOperations);
        console.log(`Finished persisting the content vectors to the ${collectionName} collection`);
    }

    //check to see if the vector index already exists on the collection
    console.log(`Checking if vector index exists in the ${collectionName} collection`)
    const vectorIndexExists = await collection.indexExists('VectorSearchIndex');
    if (!vectorIndexExists) {
        await db.command({
            "createIndexes": collectionName,
            "indexes": [
                {
                    "name": "VectorSearchIndex",
                    "key": {
                        "contentVector": "cosmosSearch"
                    },
                    "cosmosSearchOptions": {
                        "kind": "vector-ivf",
                        "numLists": 1,
                        "similarity": "COS",
                        "dimensions": 1536
                    }
                }
            ]
        });
        console.log(`Created vector index on contentVector field on ${collectionName} collection`);
    }
    else {
        console.log(`Vector index already exists on contentVector field in the ${collectionName} collection`);
    }
}

// function to perform vector search
async function vectorSearch(db, collectionName, query, numResults = 3) {
    const collection = db.collection(collectionName);
    // generate the embedding for incoming question
    const queryEmbedding = await generateEmbeddings(query);

    const pipeline = [
        {
            '$search': {
                "cosmosSearch": {
                    "vector": queryEmbedding,
                    "path": "contentVector",
                    "k": numResults
                },
                "returnStoredSource": true
            }
        },
        { '$project': { 'similarityScore': { '$meta': 'searchScore' }, 'document': '$$ROOT' } }
    ];

    //perform vector search and return the results as an array
    const results = await collection.aggregate(pipeline).toArray();
    return results;
}
// function to print search results
function printProductSearchResult(result) {
    // Print the search result document in a readable format  
    console.log(`Similarity Score: ${result['similarityScore']}`);
    console.log(`Name: ${result['document']['Name']}`);
    console.log(`Category: ${result['document']['Category']}`);
    console.log(`Description: ${result['document']['Description']}`);
    // console.log(`_id: ${result['document']['_id']}\n`);  
}

// function to perform RAG with vector search
async function ragWithVectorsearch(db, collectionName, question, numResults = 3) {
    //A system prompt describes the responsibilities, instructions, and persona of the AI.
    const systemPrompt = `
        You are a helpful, knowledgeable and friendly product consultant for Cosmic Works, a consultancy service.
        Your name is Cosmo.
        Product Managers come to Cosmo for advice on potential products that they want to build for their end customers.
        You are designed to answer questions about what product to build based on end consumer and their pain point that the product is expected to solve.
        
        Only answer questions related to the information provided in the list of products below that are represented
        in JSON format.
        
        If you are asked a question that is not in the list, respond with the best of your knowledge.
        
        List of products:
    `;
    const collection = db.collection(collectionName);
    //generate vector embeddings for the incoming question
    const queryEmbedding = await generateEmbeddings(question);
    //perform vector search and return the results
    results = await vectorSearch(db, collectionName, question, numResults);
    productList = "";
    //remove contentVector from the results, create a string of the results for the prompt
    for (const result of results) {
        delete result['document']['contentVector'];
        productList += JSON.stringify(result['document']) + "\n\n";
    }

    //assemble the prompt for the large language model (LLM)
    const formattedPrompt = systemPrompt + productList;
    //prepare messages for the LLM call, TODO: if message history is desired, add them to this messages array
    const messages = [
        {
            "role": "system",
            "content": formattedPrompt
        },
        {
            "role": "user",
            "content": question
        }
    ];

    //call the Azure OpenAI model to get the completion and return the response
    const completion = await aoaiClient.getChatCompletions(completionsDeploymentName, messages);
    return completion.choices[0].message.content;
}

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

// creates reusable langchain rag chain
async function ragLCELChain(question) { 
    // A system prompt describes the responsibilities, instructions, and persona of the AI.
    // Note the addition of the templated variable/placeholder for the list of products and the incoming question.
    const systemPrompt = `
        You are a helpful, knowledgeable and friendly product consultant for Cosmic Works, a consultancy service.
        Your name is Cosmo.
        Product Managers come to Cosmo for advice on potential products that they want to build for their end customers.
        You are designed to answer questions about what product to build based on end consumer and their pain point that the product is expected to solve.
        
        Only answer questions related to the information provided in the list of products below that are represented
        in JSON format.
        
        If you are asked a question that is not in the list, respond with the best of your knowledge.
        
        List of products:
        {products}

        Question:
        {question}
    `;

    // Use a retriever on the Cosmos DB vector store
    const retriever = vectorStore.asRetriever();

    // Initialize the prompt
    const prompt = PromptTemplate.fromTemplate(systemPrompt);

    // The RAG chain will populate the variable placeholders of the system prompt
    // with the formatted list of products based on the documents retrieved from the vector store.
    // The RAG chain will then invoke the LLM with the populated prompt and the question.
    // The response from the LLM is then parsed as a string and returned.
    const ragChain  = RunnableSequence.from([
        {
            products: retriever.pipe(formatDocuments),
            question: new RunnablePassthrough()
        },
        prompt,
        chatModel,
        new StringOutputParser()
    ]);

    return await ragChain.invoke(question);
}

// langchain agent executor
async function buildAgentExecutor() {
    // A system prompt describes the responsibilities, instructions, and persona of the AI.
    // Note the variable placeholders for the list of products and the incoming question are not included.
    // An agent system prompt contains only the persona and instructions for the AI.
    const systemMessage = `
        You are a helpful, knowledgeable and friendly product consultant for Cosmic Works, a consultancy service.
        Your name is Cosmo.
        Product Managers come to Cosmo for advice on potential products that they want to build for their end customers.
        You are designed to answer questions about what product to build based on end consumer and their pain point that the product is expected to solve.
        
        Only answer questions related to the information provided in the list of products below that are represented
        in JSON format.
        
        If you are asked a question that is not in the list, respond with the best of your knowledge.     
        `;
    // Create vector store retriever chain to retrieve documents and formats them as a string for the prompt.
    const retrieverChain = vectorStore.asRetriever().pipe(formatDocuments);

    // Define tools for the agent can use, the description is important this is what the AI will 
    // use to decide which tool to use.

    // A tool that retrieves product information from Cosmic Works based on the user's question.
    const productsRetrieverTool = new DynamicTool({
        name: "products_retriever_tool",
        description: `Searches Cosmic Works product information for similar products based on the question. 
                    Returns the product information in JSON format.`,
        func: async (input) => await retrieverChain.invoke(input),
    });

    // A tool that will lookup a product by its SKU. Note that this is not a vector store lookup.
    const productLookupTool = new DynamicTool({
        name: "product_sku_lookup_tool",
        description: `Searches Cosmic Works product information for a single product by its SKU.
                    Returns the product information in JSON format.
                    If the product is not found, returns null.`,
        func: async (input) => {
            const db = dbClient.db("cosmic_works");
            const products = db.collection("products");
            const doc = await products.findOne({ "sku": input });            
            if (doc) {                
                //remove the contentVector property to save on tokens
                delete doc.contentVector;
            }
            return doc ? JSON.stringify(doc, null, '\t') : null;
        },
    });

    // Generate OpenAI function metadata to provide to the LLM
    // The LLM will use this metadata to decide which tool to use based on the description.
    const tools = [productsRetrieverTool, productLookupTool];
    const modelWithFunctions = chatModel.bind({
        functions: tools.map((tool) => convertToOpenAIFunction(tool)),
    });

    // OpenAI function calling is fine-tuned for tool using therefore you don't need to provide instruction.
    // All that is required is that there be two variables: `input` and `agent_scratchpad`.
    // Input represents the user prompt and agent_scratchpad acts as a log of tool invocations and outputs.
    const prompt = ChatPromptTemplate.fromMessages([
        ["system", systemMessage],
        ["human", "{input}"],
        new MessagesPlaceholder(variable_name="agent_scratchpad")
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
    const result = await agentExecutor.invoke({input});
    
    // Output the intermediate steps of the agent if returnIntermediateSteps is set to true
    if (agentExecutor.returnIntermediateSteps) {
        console.log(JSON.stringify(result.intermediateSteps, null, 2));
    }
    // Return the final response from the agent
    return result.output;
}

// calling main function
main().catch(console.error);