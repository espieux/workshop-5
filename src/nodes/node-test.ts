// Import necessary modules
import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import { delay } from "../utils";

// Define the node function
export async function node(
    nodeId: number,
    N: number,
    F: number,
    initialValue: Value,
    isFaulty: boolean,
    nodesAreReady: () => boolean,
    setNodeIsReady: (index: number) => void
) {
  // Initialize express and middleware
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // Initialize node state and data structures
  let currentNodeState: NodeState = {
    killed: false,
    x: null,
    decided: null,
    k: null,
  }
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  // Define route to get node status
  node.get("/status", (req, res) => {
    res.status(isFaulty ? 500 : 200).send(isFaulty ? "faulty" : "live");
  });

  // Define route to stop the node
  node.get("/stop", (req, res) => {
    currentNodeState.killed = true;
    res.status(200).send("killed");
  });

  // Define route to get the current state of a node
  node.get("/getState", (req, res) => {
    res.status(200).send(currentNodeState);
  });

  // Define route to start the consensus algorithm
  node.get("/start", async (req, res) => {
    // Wait until all nodes are ready
    while (!nodesAreReady()) {
      await delay(5);
    }

    // If node is not faulty, start consensus algorithm
    if (!isFaulty) {
      currentNodeState = { k: 1, x: initialValue, decided: false, killed: currentNodeState.killed };
      // Send proposal to all nodes
      for (let i = 0; i < N; i++) {
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ k: currentNodeState.k, x: currentNodeState.x, messageType: "propose" }),
        });
      }
    } else {
      // If node is faulty, reset state
      currentNodeState = { k: null, x: null, decided: null, killed: currentNodeState.killed };
    }

    res.status(200).send("Consensus algorithm started.");
  });

  // Define route to receive messages
  node.post("/message", async (req, res) => {
    let { k, x, messageType } = req.body;
    if (!isFaulty && !currentNodeState.killed) {
      if (messageType == "propose") {
        if (!proposals.has(k)) {
          proposals.set(k, []);
        }
        proposals.get(k)!.push(x); // Use '!' to assert non-null after the check
        let proposal = proposals.get(k)!;

        if (proposal.length >= (N - F)) {
          let count0 = proposal.filter((el) => el == 0).length;
          let count1 = proposal.filter((el) => el == 1).length;
          if (count0 > (N / 2)) {
            x = 0;
          } else if (count1 > (N / 2)) {
            x = 1;
          } else {
            x = "?";
          }
          for (let i = 0; i < N; i++) {
            fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ k: k, x: x, messageType: "vote" }),
            });
          }
        }
      }
      else if (messageType == "vote") {
        if (!votes.has(k)) {
          votes.set(k, []);
        }
        votes.get(k)!.push(x)
        let vote = votes.get(k)!;
          if (vote.length >= (N - F)) {
            let count0 = vote.filter((el) => el == 0).length;
            let count1 = vote.filter((el) => el == 1).length;

            if (count0 >= F + 1) {
              currentNodeState.x = 0;
              currentNodeState.decided = true;
            } else if (count1 >= F + 1) {
              currentNodeState.x = 1;
              currentNodeState.decided = true;
            } else {
              if (count0 + count1 > 0 && count0 > count1) {
                currentNodeState.x = 0;
              } else if (count0 + count1 > 0 && count0 < count1) {
                currentNodeState.x = 1;
              } else {
                currentNodeState.x = Math.random() > 0.5 ? 0 : 1;
              }
              currentNodeState.k = k + 1;

              for (let i = 0; i < N; i++) {
                fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({k: currentNodeState.k, x: currentNodeState.x, messageType: "propose"}),
                });

            }
          }
        }
      }
    }
    res.status(200).send("Message received and processed.");
  });

  // Start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}