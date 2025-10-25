# Scaling Workers

How to scale Temporal workers effectively in production environments.

## The Challenge

As your Temporal workloads grow, you need to think carefully about how to scale your worker pools. Simply adding more workers isn't always the answer.

## Key Principles

1. **Understand your workflow patterns** - Are they CPU-bound or I/O-bound?
2. **Monitor queue depths** - This tells you when you need more capacity
3. **Use task queues strategically** - Different workflows may need different worker pools
4. **Consider sticky workflows** - For workflows that maintain state, sticky execution can improve performance

## Implementation Strategy

Start with a baseline deployment and measure. Add horizontal scaling based on metrics like queue depth and worker utilization. Don't forget to account for deployment and shutdown gracefully — Temporal workers need time to complete in-flight workflows.

